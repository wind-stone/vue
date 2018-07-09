/* @flow */

/**
 * 返回组件的 vnode，需要做以下处理：
 * 1. 若`Ctor`是组件选项对象，将`Ctor`转变成构造函数
 * 2. 若`Ctor`是工厂函数，执行工厂函数，将结果返回给`Ctor`（详见`./helpers/resolve-async-component.md`）
 *     - 若工厂函数异步获取组件，则直接返回一个空的 vnode 节点，不再继续之后的步骤；等到组件异步获取成功，再调用`vm.$forceUpdate()`重新获取 Vnode Tree
 *     - 若工厂函数同步返回构造函数，继续下一步
 * 3. 处理`Ctor.options`
 * 4. 将组件的`v-model`转换成`props`&`event`
 * 5. 从 VNodeData 里提取出 propsData（详见`./helpers/extract-props.md`）
 * 6. 若组件是函数式组件，创建函数式组件的 vnode 节点并返回，不再继续之后的步骤（详见`./create-functional-component.md`）
 * 7. 处理监听器，`listeners`为组件的事件监听器，`data.on`是原生事件的监听器
 * 8. 处理抽象组件的`slot`
 * 9. 合并 hooks，这些 hooks 在 vnode patch 的时候调用
 * 10. 创建组件的 vnode 节点，并返回
 */

import VNode from './vnode'
import { resolveConstructorOptions } from 'core/instance/init'
import { queueActivatedComponent } from 'core/observer/scheduler'
import { createFunctionalComponent } from './create-functional-component'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  isObject
} from '../util/index'

import {
  resolveAsyncComponent,
  createAsyncPlaceholder,
  extractPropsFromVNodeData
} from './helpers/index'

import {
  callHook,
  activeInstance,
  updateChildComponent,
  activateChildComponent,
  deactivateChildComponent
} from '../instance/lifecycle'

import {
  isRecyclableComponent,
  renderRecyclableComponentTemplate
} from 'weex/runtime/recycle-list/render-component-template'

// inline hooks to be invoked on component VNodes during patch
const componentVNodeHooks = {
  init (vnode: VNodeWithData, hydrating: boolean): ?boolean {
    if (
      vnode.componentInstance &&
      !vnode.componentInstance._isDestroyed &&
      vnode.data.keepAlive
    ) {
      // kept-alive components, treat as a patch
      const mountedNode: any = vnode // work around flow
      componentVNodeHooks.prepatch(mountedNode, mountedNode)
    } else {
      const child = vnode.componentInstance = createComponentInstanceForVnode(
        vnode,
        activeInstance
      )
      child.$mount(hydrating ? vnode.elm : undefined, hydrating)
    }
  },

  prepatch (oldVnode: MountedComponentVNode, vnode: MountedComponentVNode) {
    const options = vnode.componentOptions
    const child = vnode.componentInstance = oldVnode.componentInstance
    updateChildComponent(
      child,
      options.propsData, // updated props
      options.listeners, // updated listeners
      vnode, // new parent vnode
      options.children // new children
    )
  },

  /**
   * 子组件完成 patch 之后，调用该 insert 钩子
   *（如果是子组件是首次挂载，会调用 mounted 钩子）
   */
  insert (vnode: MountedComponentVNode) {
    const { context, componentInstance } = vnode
    if (!componentInstance._isMounted) {
      componentInstance._isMounted = true
      callHook(componentInstance, 'mounted')
    }
    if (vnode.data.keepAlive) {
      if (context._isMounted) {
        // vue-router#1212
        // During updates, a kept-alive component's child components may
        // change, so directly walking the tree here may call activated hooks
        // on incorrect children. Instead we push them into a queue which will
        // be processed after the whole patch process ended.
        queueActivatedComponent(componentInstance)
      } else {
        activateChildComponent(componentInstance, true /* direct */)
      }
    }
  },

  destroy (vnode: MountedComponentVNode) {
    const { componentInstance } = vnode
    if (!componentInstance._isDestroyed) {
      if (!vnode.data.keepAlive) {
        componentInstance.$destroy()
      } else {
        deactivateChildComponent(componentInstance, true /* direct */)
      }
    }
  }
}

const hooksToMerge = Object.keys(componentVNodeHooks)

export function createComponent (
  Ctor: Class<Component> | Function | Object | void,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag?: string
): VNode | Array<VNode> | void {
  if (isUndef(Ctor)) {
    return
  }

  // _base 为 Vue 构造函数
  const baseCtor = context.$options._base

  // plain options object: turn it into a constructor
  // 组件选项对象：转换成构造函数
  if (isObject(Ctor)) {
    Ctor = baseCtor.extend(Ctor)
  }

  // if at this stage it's not a constructor or an async component factory,
  // reject.
  if (typeof Ctor !== 'function') {
    if (process.env.NODE_ENV !== 'production') {
      warn(`Invalid Component definition: ${String(Ctor)}`, context)
    }
    return
  }

  // async component
  // 如果是通过工厂函数异步获取的组件选项对象，则会先返回一个空的 vnode 的节点，等到真正的组件选项对象返回时，会调用`context`即`vm`的`$forceUpdate()`方法重新获取 VNode Tree（重新获取时，异步组件已经 ready，会同步返回构造函数）
  let asyncFactory
  if (isUndef(Ctor.cid)) {
    asyncFactory = Ctor
    /**
     * 解析异步组件
     *
     * - 首次解析
     *   - 若工厂函数同步 resolve 组件选项对象，则返回基于组件选项对象扩展的构造函数
     *   - 若工厂函数异步 resolve 组件选项对象
     *     - 若是高级异步组件 && 存在加载中组件 && delay 为 0，则返回基于加载中组件选项对象扩展的构造函数
     *     - 否则，返回 undefined（之后会强制渲染，再次解析异步组件）
     * - 再次解析
     *   - 若组件加载出错 && 高级异步组件存在出错时组件，返回基于出错时的组件选项对象扩展的构造函数
     *   - 若组件异步加载成功，返回基于组件选项对象扩展的构造函数
     *   - 若 delay 时间到达 && 仍处于异步加载过程中 && 高级异步组件存在加载中组件，返回基于加载中组件选项对象扩展的构造函数
     */
    Ctor = resolveAsyncComponent(asyncFactory, baseCtor, context)
    if (Ctor === undefined) {
      // return a placeholder node for async component, which is rendered
      // as a comment node but preserves all the raw information for the node.
      // the information will be used for async server-rendering and hydration.
      return createAsyncPlaceholder(
        asyncFactory,
        data,
        context,
        children,
        tag
      )
    }
  }

  data = data || {}

  // resolve constructor options in case global mixins are applied after
  // component constructor creation
  resolveConstructorOptions(Ctor)

  // transform component v-model data into props & events
  if (isDef(data.model)) {
    transformModel(Ctor.options, data)
  }

  // extract props
  // 从 vnode 的 data 里提取出 props 数据，详见 ./helpers/extract-props.md
  const propsData = extractPropsFromVNodeData(data, Ctor, tag)

  // functional component
  if (isTrue(Ctor.options.functional)) {
    return createFunctionalComponent(Ctor, propsData, data, context, children)
  }

  // extract listeners, since these needs to be treated as
  // child component listeners instead of DOM listeners
  const listeners = data.on
  // replace with listeners with .native modifier
  // so it gets processed during parent component patch.
  data.on = data.nativeOn

  if (isTrue(Ctor.options.abstract)) {
    // abstract components do not keep anything
    // other than props & listeners & slot

    // work around flow
    const slot = data.slot
    data = {}
    if (slot) {
      data.slot = slot
    }
  }

  // install component management hooks onto the placeholder node
  installComponentHooks(data)

  // return a placeholder vnode
  // 注意：针对所有的组件，返回的 vnode 都是占位的 vnode
  const name = Ctor.options.name || tag
  const vnode = new VNode(
    `vue-component-${Ctor.cid}${name ? `-${name}` : ''}`,
    data, undefined, undefined, undefined, context,
    // vnode.componentOptions
    { Ctor, propsData, listeners, tag, children },
    asyncFactory
  )

  // Weex specific: invoke recycle-list optimized @render function for
  // extracting cell-slot template.
  // https://github.com/Hanks10100/weex-native-directive/tree/master/component
  /* istanbul ignore if */
  if (__WEEX__ && isRecyclableComponent(vnode)) {
    return renderRecyclableComponentTemplate(vnode)
  }

  return vnode
}

/**
 * 针对 vnode 创建组件实例
 * @param {*} vnode 组件对应的 vnode（vnode.name 的格式为 vue-component-Ctor.cid-name）
 * @param {*} parent 创建该组件时，处于活动状态的父组件，如此形成组件链
 * @param {*} parentElm 要插入到的 DOM 元素
 * @param {*} refElm 如果存在，组件将插入到 parentElm 之下，refElm 之前
 */
export function createComponentInstanceForVnode (
  vnode: any, // we know it's MountedComponentVNode but flow doesn't
  parent: any, // activeInstance in lifecycle state
): Component {
  const options: InternalComponentOptions = {
    _isComponent: true,
    _parentVnode: vnode,
    parent
  }
  // check inline-template render functions
  const inlineTemplate = vnode.data.inlineTemplate
  if (isDef(inlineTemplate)) {
    options.render = inlineTemplate.render
    options.staticRenderFns = inlineTemplate.staticRenderFns
  }
  return new vnode.componentOptions.Ctor(options)
}

function installComponentHooks (data: VNodeData) {
  const hooks = data.hook || (data.hook = {})
  for (let i = 0; i < hooksToMerge.length; i++) {
    const key = hooksToMerge[i]
    const existing = hooks[key]
    const toMerge = componentVNodeHooks[key]
    if (existing !== toMerge && !(existing && existing._merged)) {
      hooks[key] = existing ? mergeHook(toMerge, existing) : toMerge
    }
  }
}

function mergeHook (f1: any, f2: any): Function {
  const merged = (a, b) => {
    // flow complains about extra args which is why we use any
    f1(a, b)
    f2(a, b)
  }
  merged._merged = true
  return merged
}

// transform component v-model info (value and callback) into
// prop and event handler respectively.
// 将 v-model 信息转换到子组件的 prop、event
function transformModel (options, data: any) {
  const prop = (options.model && options.model.prop) || 'value'
  const event = (options.model && options.model.event) || 'input'
  ;(data.props || (data.props = {}))[prop] = data.model.value
  const on = data.on || (data.on = {})
  if (isDef(on[event])) {
    on[event] = [data.model.callback].concat(on[event])
  } else {
    on[event] = data.model.callback
  }
}
