/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

/**
 * 在决定是否要给某个数据做响应式处理转换时，需要使用到`shouldConvert`，只有其中为`true`时，才进行响应式处理转换
 */
export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that has this object as root $data

  constructor (value: any) {
    this.value = value

    // ob 对象的 dep 属性，也是用来收集订阅者，但只有在发生以下情况时，才会通知所有的订阅者
    // 1. 对象添加/删除属性
    // 2. 数组执行了变异方法，导致数组增加、删除元素、重排序
    this.dep = new Dep()

    this.vmCount = 0
    def(value, '__ob__', this)
    if (Array.isArray(value)) {
      // 如果是数组，则重写数组的变异方法（变异方法执行后，将通知依赖方数组已经改变，如有必要，将给新增的元素做响应式处理）
      const augment = hasProto
        ? protoAugment
        : copyAugment
      augment(value, arrayMethods, arrayKeys)
      this.observeArray(value)
    } else {
      this.walk(value)
    }
  }

  /**
   * Walk through each property and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment an target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment (target, src: Object, keys: any) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment an target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 *
 * 为对象或数组（非 Vnode）创建观察者实例
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  } else if (
    shouldObserve &&
    // 非服务端渲染
    !isServerRendering() &&
    // value 是对象或数组
    (Array.isArray(value) || isPlainObject(value)) &&
    // 对象是可扩展的
    Object.isExtensible(value) &&
    // 非根组件
    !value._isVue
  ) {
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

/**
 * Define a reactive property on an Object.
 *
 * 在对象上定义响应式属性
 *
 * @param {*} obj 属性所在的对象
 * @param {*} key 属性名称
 * @param {*} val 属性值
 * @param {*} val customSetter
 * @param {*} val shallow
 */
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  // 属性的闭包 dep，该 dep 所收集的 Watcher，会在该属性值自身发生变化时接收到通知
  const dep = new Dep()

  const property = Object.getOwnPropertyDescriptor(obj, key)
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  // 处理属性为访问器属性的情况
  const getter = property && property.get
  const setter = property && property.set
  if ((!getter || setter) && arguments.length === 2) {
    // 未传入属性值时，若属性不是访问器属性（而是数据属性）或者是访问器属性且 getter、setter 都存在，
    // 则设置属性值
    val = obj[key]
  }

  // 递归地对 val 进行响应式处理，并返回 val 对应的 __ob__
  let childOb = !shallow && observe(val)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    // 每次获取当前属性值时，都要收集订阅者、
    get: function reactiveGetter () {
      const value = getter ? getter.call(obj) : val
      if (Dep.target) {
        // 1、依赖收集：
        //   - 该属性值的闭包 dep 将当前 Dep.target 作为订阅者
        //   - 当前 Dep.target 将该属性值的闭包 dep 作为依赖
        // 以便该属性值自身变化时，通知订阅者
        dep.depend()
        if (childOb) {
          // 2、子属性的依赖收集（仅当该属性值为对象时）：
          //   - 该属性值对应的观察对象的属性 dep 将当前 Dep.target 作为订阅者
          //   - 当前 Dep.target 将该属性值对应的观察对象的属性 dep 作为依赖
          // 以便该属性值动态增加/删除 属性/元素 的时候通知 watcher
          childOb.dep.depend()
          if (Array.isArray(value)) {
            // 3、若该属性值是数组，还需递归针对数组每个元素进行子属性的依赖收集
            dependArray(value)
          }
        }
      }
      return value
    },
    set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      if (newVal === value || (newVal !== newVal && value !== value)) {
        // 新旧值相同，或同为`NaN`，则不做任何处理
        return
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      childOb = !shallow && observe(newVal)
      // 属性值自身发生改变，通知订阅者
      dep.notify()
    }
  })
}

/**
 * 为了解决检测对象动态添加/删除属性的问题，Vue.js 里提供了全局的`Vue.set`、`Vue.del`方法，用于给某个已经经过响应式处理的对象来动态添加和删除属性，并触发通知。
 */

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  if (key in target && !(key in Object.prototype)) {
    // 若 target 存在自有的 key 属性
    target[key] = val
    return val
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  if (!ob) {
    // 未经过响应式处理的引用类型
    target[key] = val
    return val
  }
  // 给新增的属性做响应式处理，并通知依赖方
  defineReactive(ob.value, key, val)
  // 注意：这里使用的是 ob.dep，而不是 defineReactive 函数里的闭包 dep，两个 dep 的作用不同
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    // 数组
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  if (!hasOwn(target, key)) {
    // 没有 key 的情况
    return
  }
  delete target[key]
  if (!ob) {
    return
  }
  // 通知依赖方
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
