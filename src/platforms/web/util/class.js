/* @flow */

import { isDef, isObject } from 'shared/util'

/**
 * 合并 class 数据，并生成最终的 class 字符串
 *
 * @param {VNode} vnode 虚拟节点
 */
export function genClassForVnode (vnode: VNodeWithData): string {
  let data = vnode.data
  let parentNode = vnode
  let childNode = vnode
  // 若该 VNode 是组件占位 VNode，则合并该组件占位 VNode 和组件渲染 VNode 上的 class/staticClass，包括组件渲染 VNode 同时也是子组件占位 VNode 的情况（即连续嵌套组件的情况）
  while (isDef(childNode.componentInstance)) {
    childNode = childNode.componentInstance._vnode
    if (childNode && childNode.data) {
      data = mergeClassData(childNode.data, data)
    }
  }
  // 若该 VNode 是组件渲染 VNode，则需要该组件渲染 VNode 和该组件的占位 Vnode 上的 class/staticClass，包括组件占位 VNode 是父组件渲染 VNode 的情况（即连续嵌套组件的情况）
  while (isDef(parentNode = parentNode.parent)) {
    if (parentNode && parentNode.data) {
      data = mergeClassData(data, parentNode.data)
    }
  }
  return renderClass(data.staticClass, data.class)
}

/**
 * 合并 class 数据
 */
function mergeClassData (child: VNodeData, parent: VNodeData): {
  staticClass: string,
  class: any
} {
  return {
    staticClass: concat(child.staticClass, parent.staticClass),
    class: isDef(child.class)
      ? [child.class, parent.class]
      : parent.class
  }
}

/**
 * 合并最终的 class 字符串（会将数组、对象等转换为字符串）和 staticClass 字符串
 */
export function renderClass (
  staticClass: ?string,
  dynamicClass: any
): string {
  if (isDef(staticClass) || isDef(dynamicClass)) {
    return concat(staticClass, stringifyClass(dynamicClass))
  }
  /* istanbul ignore next */
  return ''
}

/**
 * 合并 staticClass，纯字符串合并
 */
export function concat (a: ?string, b: ?string): string {
  return a ? b ? (a + ' ' + b) : a : (b || '')
}

/**
 * 将 class 数据转换成字符串形式
 */
export function stringifyClass (value: any): string {
  if (Array.isArray(value)) {
    return stringifyArray(value)
  }
  if (isObject(value)) {
    return stringifyObject(value)
  }
  if (typeof value === 'string') {
    return value
  }
  /* istanbul ignore next */
  return ''
}

/**
 * 将数组形式的 class 数据转成字符串形式
 */
function stringifyArray (value: Array<any>): string {
  let res = ''
  let stringified
  for (let i = 0, l = value.length; i < l; i++) {
    if (isDef(stringified = stringifyClass(value[i])) && stringified !== '') {
      if (res) res += ' '
      res += stringified
    }
  }
  return res
}

/**
 * 将对象形式的 class 数据转成字符串形式
 */
function stringifyObject (value: Object): string {
  let res = ''
  for (const key in value) {
    if (value[key]) {
      if (res) res += ' '
      res += key
    }
  }
  return res
}
