/* @flow */

import config from '../config'
import { initProxy } from './proxy'
import { initState } from './state'
import { initRender } from './render'
import { initEvents } from './events'
import { mark, measure } from '../util/perf'
import { initLifecycle, callHook } from './lifecycle'
import { initProvide, initInjections } from './inject'
import { extend, mergeOptions, formatComponentName } from '../util/index'

let uid = 0

export function initMixin (Vue: Class<Component>) {
  Vue.prototype._init = function (options?: Object) {
    const vm: Component = this
    // a uid
    vm._uid = uid++

    let startTag, endTag
    /* istanbul ignore if */
    // 非生产环境下，做性能记录
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`
      endTag = `vue-perf-end:${vm._uid}`
      mark(startTag)
    }

    // a flag to avoid this being observed
    // 标明是 vue 实例
    vm._isVue = true
    // merge options
    if (options && options._isComponent) {
      // 通过 patch 函数里的 createComponent 来生成组件 vnode 的组件实例时（实际上是在vnode.data.hook.init 里调用 new vnode.componentOptions.Ctor(options) 生成组件实例）

      // optimize internal component instantiation
      // since dynamic options merging is pretty slow, and none of the
      // internal component options needs special treatment.

      // 调用 initInternalComponent 函数后，合并的 options 已经挂载到 vm.$options
      initInternalComponent(vm, options)
    } else {
      // 根组件实例（通过用户调用 new Vue({...}) 生成组件实例）
      /**
       * 初始化 Vue 实例/组件时，需要将`Ctor.options`（考虑到继承，这里不只是`Vue.options`）与传入的`options`选项合并成新的`options`后，再做下一步处理。而在合并`options`前，需要做一些处理，比如获取最新的`Ctor.options`。

       * 之所以要获取最新的`Ctor.options`，是因为如果`Ctor`是继承而来的话，`Ctor.options`实际上是由父类`Super`的`Super.options`与`Ctor`继承`Super`时传入的`extendOptions`合并而来的，且`Super.options`/`Ctor.options`都可能通过`Super/Ctor.mixin`方法注入新的选项。

      * 注意项：
      *   - 通过`mergeOptions`源码可知，每次有两个`options`合并之后，总会返回一新的`options`引用对象
      *   - `mergeOptions`里合并各个`key`时，其`value`也是返回新的`value`引用对象（除了`data`的合并）
      */
      vm.$options = mergeOptions(
        // 返回最新的 vm.constructor.options
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      )
    }
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      initProxy(vm)
    } else {
      vm._renderProxy = vm
    }
    // expose real self
    vm._self = vm
    initLifecycle(vm)
    initEvents(vm)
    initRender(vm)
    callHook(vm, 'beforeCreate')
    initInjections(vm) // resolve injections before data/props
    initState(vm)
    initProvide(vm) // resolve provide after data/props
    callHook(vm, 'created')

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      vm._name = formatComponentName(vm, false)
      mark(endTag)
      measure(`vue ${vm._name} init`, startTag, endTag)
    }

    // （根组件实例）存在 el 属性，挂载到 el 上（替换掉 el）
    if (vm.$options.el) {
      vm.$mount(vm.$options.el)
    }
  }
}

/**
 * 针对组件实例，合并 vm.constructor.options 和 new Ctor(options) 时传入的 options
 * 请同时参考 create-component.js 里的 createComponentInstanceForVnode 函数
 */
export function initInternalComponent (vm: Component, options: InternalComponentOptions) {
  const opts = vm.$options = Object.create(vm.constructor.options)
  // doing this because it's faster than dynamic enumeration.
  // 子组件的占位 VNode
  const parentVnode = options._parentVnode
  // 创建子组件时的活动实例
  opts.parent = options.parent
  // opts._parentVnode：组件实例对应的 vnode 的父 vnode
  opts._parentVnode = parentVnode

  // 将组件占位 VNode 上有关组件的数据，转存到 vm.$options 上
  const vnodeComponentOptions = parentVnode.componentOptions
  opts.propsData = vnodeComponentOptions.propsData
  opts._parentListeners = vnodeComponentOptions.listeners
  opts._renderChildren = vnodeComponentOptions.children
  opts._componentTag = vnodeComponentOptions.tag

  if (options.render) {
    opts.render = options.render
    opts.staticRenderFns = options.staticRenderFns
  }
}

/**
 * 返回最新的 Ctor.options，以及更新 Ctor.extendOptions
 *
 * 1. 若 Ctor 不是通过 Vue.extend 继承而来的，直接返回 Ctor.options
 * 2. 否则，返回计算而来的最新的 Ctor.options。此处要考虑的问题是
 *    a. 继承的基类 Ctor.super.options 可能发生变化（通过调用 Ctor.super.mixin() 而造成的）
 *    b. Ctor.options 可能发生变化（通过调用 Ctor.mixin() 而造成的）
 */
export function resolveConstructorOptions (Ctor: Class<Component>) {
  let options = Ctor.options
  // 如果存在父类，即该 Ctor 是继承而来的子类
  if (Ctor.super) {
    // 当前计算得的最新的 Ctor.super.options
    const superOptions = resolveConstructorOptions(Ctor.super)
    // 子类继承时保存的 Ctor.super.options
    const cachedSuperOptions = Ctor.superOptions

    if (superOptions !== cachedSuperOptions) {
      // super option changed,
      // need to resolve new options.
      Ctor.superOptions = superOptions
      // check if there are any late-modified/attached options (#4976)
      const modifiedOptions = resolveModifiedOptions(Ctor)
      // update base extend options
      if (modifiedOptions) {
        // 动态更新 Ctor.extendOptions，以确保其包含了通过 Ctor.mixin 添加、修改的选项（配置合并不会出现删除的情况）
        extend(Ctor.extendOptions, modifiedOptions)
      }

      // 基于最新的 Ctor.super.options 和 Ctor.extendOptions 合并配置
      options = Ctor.options = mergeOptions(superOptions, Ctor.extendOptions)
      if (options.name) {
        options.components[options.name] = Ctor
      }
    }
  }
  return options
}


/**
 * 返回通过调用 Ctor.mixin 从而导致 Ctor.options 里选项改变的那些选项及其值
 */
function resolveModifiedOptions (Ctor: Class<Component>): ?Object {
  let modified

  // 最新的 Ctor.options（可能已经通过 Ctor.mixin 改变了）
  const latest = Ctor.options

  // 上一次继承 Super 时调用 Super.extend(extendOptions) 传入的选项对象
  const extended = Ctor.extendOptions

  // 上一次继承 Super 时（合并）Ctor.options 后的副本
  const sealed = Ctor.sealedOptions

  for (const key in latest) {
    // Ctor.mixin 是通过 mergeOptions 合并选项的，返回的 value 都是新的引用对象
    if (latest[key] !== sealed[key]) {
      if (!modified) modified = {}
      // 返回 Ctor.options 里改变的选项值（经过去重）
      modified[key] = dedupe(latest[key], extended[key], sealed[key])
    }
  }
  return modified
}

/**
 * 数据去重，若选项值不是数据，直接返回 latest，否则返回那些在 latest 里 &&（在 extended 里 || 不在 sealed 里的）
 */
function dedupe (latest, extended, sealed) {
  // compare latest and sealed to ensure lifecycle hooks won't be duplicated
  // between merges
  if (Array.isArray(latest)) {
    const res = []
    sealed = Array.isArray(sealed) ? sealed : [sealed]
    extended = Array.isArray(extended) ? extended : [extended]
    for (let i = 0; i < latest.length; i++) {
      // push original options and not sealed options to exclude duplicated options
      // 筛选出：曾经在 extended 里以及 后来通过 Ctor.mixin 加入的（即不在 sealed 里）
      if (extended.indexOf(latest[i]) >= 0 || sealed.indexOf(latest[i]) < 0) {
        res.push(latest[i])
      }
    }
    return res
  } else {
    return latest
  }
}
