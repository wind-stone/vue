/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

/**
 * 我们知道，调用数组的以下方法，会导致数组本身添加/删除元素或者数组元素排序改变。
 *   - push
 *   - pop
 *   - shift
 *   - unshift
 *   - splice
 *   - sort
 *   - reverse
 *
 * 在创建数组的`observer`时，会改写该数组的上述方法。在改写后的方法里，
 *   1. 如果是`push`、`unshift`、`splice`方法，会给新增的元素做响应式处理
 *   2. 数组发生改变，通知依赖方
 */

import { def } from '../util/index'

const arrayProto = Array.prototype
export const arrayMethods = Object.create(arrayProto)

const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

/**
 * Intercept mutating methods and emit events
 */
methodsToPatch.forEach(function (method) {
  // cache original method
  const original = arrayProto[method]
  def(arrayMethods, method, function mutator (...args) {
    const result = original.apply(this, args)
    const ob = this.__ob__
    let inserted
    switch (method) {
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        inserted = args.slice(2)
        break
    }
    // 如果新增了元素，则对新增的元素做响应式处理
    if (inserted) ob.observeArray(inserted)
    // notify change
    // 通知依赖方
    ob.dep.notify()
    return result
  })
})
