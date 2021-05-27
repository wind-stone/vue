/* @flow */

/**
 * 该文件主要是处理异步组件，返回基于组件选项对象的构造函数。
 *
 * 异步组件定义的几种形式：
 * （详见 https://cn.vuejs.org/v2/guide/components.html#%E5%BC%82%E6%AD%A5%E7%BB%84%E4%BB%B6）
 * 1. 工厂函数同步 resolve 组件选项对象
 * 2. 工厂函数异步 resolve 组件选项对象
 * 3. 工厂函数返回 Promise 实例
 * 4. 工厂函数返回对象，对象里含有组件选项对象、加载时的组件选项对象、出错时的组件定义对象等
 */

import {
  warn,
  once,
  isDef,
  isUndef,
  isTrue,
  isObject,
  hasSymbol,
  isPromise,
  remove
} from 'core/util/index'

import { createEmptyVNode } from 'core/vdom/vnode'
import { currentRenderingInstance } from 'core/instance/render'

/**
 * 基于组件选项对象，返回生成的组件构造函数
 * @param {*} comp 组件选项对象
 */
function ensureCtor (comp: any, base) {
  if (
    comp.__esModule ||
    (hasSymbol && comp[Symbol.toStringTag] === 'Module')
  ) {
    // 若是 CommonJS 的模块对象，则取模块对象的 default 属性值
    comp = comp.default
  }
  return isObject(comp)
    ? base.extend(comp)
    : comp
}

/**
 * 创建一个空的 vnode 节点
 */
export function createAsyncPlaceholder (
  factory: Function,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag: ?string
): VNode {
  const node = createEmptyVNode()
  node.asyncFactory = factory
  node.asyncMeta = { data, context, children, tag }
  return node
}

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
export function resolveAsyncComponent (
  factory: Function,
  baseCtor: Class<Component>
): Class<Component> | void {
  // 高级异步组件：（经过 timeout 时间后再次解析异步组件时）异步组件加载超时，强制渲染“渲染错误组件”
  if (isTrue(factory.error) && isDef(factory.errorComp)) {
    return factory.errorComp
  }

  // （再次解析异步组件时）若之前已经解析过该异步组件，解析后的构造函数会挂在 factory.resolved 上，则直接使用解析好的构造函数
  if (isDef(factory.resolved)) {
    return factory.resolved
  }

  const owner = currentRenderingInstance
  if (owner && isDef(factory.owners) && factory.owners.indexOf(owner) === -1) {
    // already pending
    factory.owners.push(owner)
  }

  // 高级异步组件：（经过 delay 时间后再次解析异步组件时）强制渲染“加载中组件”
  if (isTrue(factory.loading) && isDef(factory.loadingComp)) {
    return factory.loadingComp
  }

  if (owner && !isDef(factory.owners)) {
    const owners = factory.owners = [owner]
    let sync = true
    let timerLoading = null
    let timerTimeout = null

    ;(owner: any).$on('hook:destroyed', () => remove(owners, owner))

    const forceRender = (renderCompleted: boolean) => {
      for (let i = 0, l = owners.length; i < l; i++) {
        (owners[i]: any).$forceUpdate()
      }

      if (renderCompleted) {
        owners.length = 0
        if (timerLoading !== null) {
          clearTimeout(timerLoading)
          timerLoading = null
        }
        if (timerTimeout !== null) {
          clearTimeout(timerTimeout)
          timerTimeout = null
        }
      }
    }

    // 封装 resolve，确保只调用一次
    const resolve = once((res: Object | Class<Component>) => {
      // cache resolved
      // ensureCtor 函数返回的是构造函数，挂在 factory.resolved 属性下，方便针对同一异步组件再次解析时直接使用
      factory.resolved = ensureCtor(res, baseCtor)
      // invoke callbacks only if this is not a synchronous resolve
      // (async resolves are shimmed as synchronous during SSR)
      if (!sync) {
        // 若是工厂函数异步 resolve 组件选项对象，则需要调用各个 context 重新强制渲染
        // 若是工厂函数同步 resolve 组件选项对象，则不需要。
        forceRender(true)
      } else {
        owners.length = 0
      }
    })

    // 封装 reject，确保只调用一次
    const reject = once(reason => {
      process.env.NODE_ENV !== 'production' && warn(
        `Failed to resolve async component: ${String(factory)}` +
        (reason ? `\nReason: ${reason}` : '')
      )
      if (isDef(factory.errorComp)) {
        factory.error = true
        // 组件获取失败，强制各个 context 重新渲染（出错时组件）
        forceRender(true)
      }
    })

    // 执行工厂函数，同步返回执行结果
    const res = factory(resolve, reject)

    // 若工厂函数返回 Promise 实例或者对象（高级异步组件）
    if (isObject(res)) {
      if (isPromise(res)) {
        // 工厂函数返回 Promise 实例
        // () => Promise
        if (isUndef(factory.resolved)) {
          res.then(resolve, reject)
        }
      } else if (isPromise(res.component)) {
        // 工厂函数返回对象（高级异步组件）
        res.component.then(resolve, reject)

        if (isDef(res.error)) {
          // 存在出错时组件选项对象
          factory.errorComp = ensureCtor(res.error, baseCtor)
        }

        if (isDef(res.loading)) {
          // 存在加载中组件选项对象
          factory.loadingComp = ensureCtor(res.loading, baseCtor)
          if (res.delay === 0) {
            // 不延时，直接展示加载中组件
            factory.loading = true
          } else {
            // 延时 delay 后展示加载中组件
            timerLoading = setTimeout(() => {
              timerLoading = null
              if (isUndef(factory.resolved) && isUndef(factory.error)) {
                // 若延时 delay 时间后，组件选项对象仍为 ready，且仍未出错，则让各个 context 重新渲染（展示加载中组件）
                factory.loading = true
                forceRender(false)
              }
            }, res.delay || 200)
          }
        }

        if (isDef(res.timeout)) {
          // 出错时的渲染组件存在
          timerTimeout = setTimeout(() => {
            timerTimeout = null
            if (isUndef(factory.resolved)) {
              reject(
                process.env.NODE_ENV !== 'production'
                  ? `timeout (${res.timeout}ms)`
                  : null
              )
            }
          }, res.timeout)
        }
      }
    }

    sync = false
    // return in case resolved synchronously
    // 若是高级组件里的加载中组件存在且不演示展现加载中组件，factory.loading 为 true，返回加载中组件的构造函数 factory.loadingComp
    // 否则，返回解析后的组件构造函数（可能为空）
    return factory.loading
      ? factory.loadingComp
      : factory.resolved
  }
}
