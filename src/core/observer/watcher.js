/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  // 该 watcher 所属的 vm
  vm: Component;
  expression: string;
  // 监听的表达式有变化后的回调
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  // 若是惰性计算(this.lazy = true)，该字段用于标志表达式的依赖是否有关改变。
  // 若依赖无改变，则在下次获取该 watcher 表达式的值时，使用上一次的计算结果
  // 否则，重新计算，返回最新的结果
  dirty: boolean;
  // 该 watcher 是否是活跃的（还在使用的）
  active: boolean;
  // 该 watcher 依赖的所有 dep
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor (
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm
    if (isRenderWatcher) {
      // 模块的 watcher
      vm._watcher = this
    }
    vm._watchers.push(this)
    // options
    if (options) {
      // 是否要深度 watch
      this.deep = !!options.deep

      // 是否是用户创造的 watcher，比如通过 $watch 调用或者组件对象的 watch 选项
      this.user = !!options.user

      // 是否是惰性计算。若是，则只有在首次获取该 watcher 的值时才计算出结果并收集依赖；否则，立即计算出结果并收集依赖
      this.lazy = !!options.lazy

      // 是否要加入 watcher queue 后异步计算（会忽略掉重复的 watcher，除非相同的 watcher 之前已经计算过）
      this.sync = !!options.sync

      // before 方法里会调用 beforeUpdate 钩子
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.lazy // for lazy watchers
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      // expOrFn 是键路径
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        // 如果 expOrFn 里检测到包含了除了 字母、小数点、$ 以外的字符，将视为无效，并报错
        this.getter = function () {}
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    // 若不是惰性 watcher，立即计算表达式的值
    this.value = this.lazy
      ? undefined
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   * 计算表达式的值，并重新收集依赖
   */
  get () {
    // 将当前 watcher 设置为全局的 Dep.target，方便该 watcher 依赖的 dep 将该 watcher 添加到订阅列表里
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      // 此处，会收集计算过程中的依赖
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        // 如果是用户创造的 watcher，计算出错的话需要报错
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        // 此处，如果是深度 watch，则收集 value 下的所有响应式属性作为依赖
        // 其原理是，不断的获取 value 下面的每一个属性值（只获取，不作其他任何改变操作），触发所有依赖将 Dep.target（此时还是当前正在计算表达式的 watcher）添加到订阅列表里
        traverse(value)
      }
      // 当前 watcher 计算结束，将 Dep.target 设置为原先的值
      popTarget()
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        // 若是该 watcher 之前没有过该 dep，则将 watcher 添加到 dep.subs（订阅者） 里
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   * 清理掉此次计算没用到的老 dep
   */
  cleanupDeps () {
    let i = this.deps.length
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        // 如果最近一次计算没有用到某个 dep，将该 watcher 从这个 dep 里删除（比如 if else 的情况）
        // （这样下次这个 dep 有变化，就不会通知这个 watcher 了）
        dep.removeSub(this)
      }
    }
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   * 依赖改变时，依赖会遍历 watcher 并调用 watcher.update
   */
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      // 若是惰性计算的 watcher，只将 dirty 标志为 true，但不重新计算表达式；等到获取 value 时，再重新计算表达式
      this.dirty = true
    } else if (this.sync) {
      // 若是同步计算，则依赖改变时，立即计算表达式
      this.run()
    } else {
      // 否则，将同一帧内的 watcher 放在一起，按 wathcer.id 排序后统一执行
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   * 依赖改变时，最终会调用该函数
   */
  run () {
    if (this.active) {
      const value = this.get()
      if (
        // 以下三种情况需要调用监听回调函数：
        // 1、表达式的返回值 value 改变了（原始值，或者是对象的引用）
        // 2、表达式的返回值 value 是对象或数组（开始 value 的引用没改变）
        // 3、深度监听的，不管最终的返回值是否改变，都要执行回调。（因为 watcher 依赖的 dep 的子孙属性改变了）
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        if (this.user) {
          try {
            this.cb.call(this.vm, value, oldValue)
          } catch (e) {
            handleError(e, this.vm, `callback for watcher "${this.expression}"`)
          }
        } else {
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  evaluate () {
    this.value = this.get()
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        // 如果 vm 不是正在被销毁，则将该 watcher 从 vm._watchers 移除
        // 因为 vm._watchers 可能有大量的 watcher，因此如果 vm 正在被销毁，就没必要从 vm._watchers 里移除 watcher（反正所有的 watcher 都没用了）
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
