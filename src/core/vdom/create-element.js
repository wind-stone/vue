/* @flow */

import config from '../config'
import VNode, { createEmptyVNode } from './vnode'
import { createComponent } from './create-component'
import { traverse } from '../observer/traverse'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  isObject,
  isPrimitive,
  resolveAsset
} from '../util/index'

import {
  normalizeChildren,
  simpleNormalizeChildren
} from './helpers/index'

const SIMPLE_NORMALIZE = 1
const ALWAYS_NORMALIZE = 2

// wrapper function for providing a more flexible interface
// without getting yelled at by flow
// createElement 是对 _createElement 进行了包装，以及标准化所有的参数
export function createElement (
  context: Component,
  tag: any,
  data: any,
  children: any,
  // 该参数目前仅在创建函数式组件时才有传入 true 的可能，当然此时也有可能传入 false
  normalizationType: any,
  alwaysNormalize: boolean
): VNode | Array<VNode> {
  // 规范化参数（因为数据对象和子节点都是可选的）
  if (Array.isArray(data) || isPrimitive(data)) {
    normalizationType = children
    children = data
    data = undefined
  }
  if (isTrue(alwaysNormalize)) {
    // 若是用户编写的 render 函数，子节点虚拟数组必须采用复杂的规范化处理方式
    normalizationType = ALWAYS_NORMALIZE
  }
  return _createElement(context, tag, data, children, normalizationType)
}


/**
 * 生成 VNode 类型的元素
 *
 * @param {*} context （创建元素时的）当前组件实例
 * @param {*} tag 可以是 HTML 标签、组件选项对象，或者解析上述任何一种的一个 async 异步函数
 * @param {*} hydrating 是否混合（服务端渲染时为 true，非服务端渲染情况下为 false）
 * @param {*} removeOnly 这个参数是给 transition-group 用的
 */
export function _createElement (
  context: Component,
  tag?: string | Class<Component> | Function | Object,
  data?: VNodeData,
  children?: any,
  normalizationType?: number
): VNode | Array<VNode> {
  if (isDef(data) && isDef((data: any).__ob__)) {
    // 这里影响显示效果，暂先注释
    // process.env.NODE_ENV !== 'production' && warn(
    //   `Avoid using observed data object as vnode data: ${JSON.stringify(data)}\n` +
    //   'Always create fresh vnode data objects in each render!',
    //   context
    // )
    // 避免使用可观察数据对象作为 VNode 的数据对象
    return createEmptyVNode()
  }
  // object syntax in v-bind
  // 适用于以下两种情况：
  //   - 动态组件：<component :is="xxx"></component>
  //   - DOM 模板解析：<table><tr is="my-row"></tr></table>
  if (isDef(data) && isDef(data.is)) {
    tag = data.is
  }
  if (!tag) {
    // in case of component :is set to falsy value
    // 当 tag 是 falsy value 时（比如空字符串''、null、undefined），则创建空文本的注释 VNode
    return createEmptyVNode()
  }
  // warn against non-primitive key
  if (process.env.NODE_ENV !== 'production' &&
    isDef(data) && isDef(data.key) && !isPrimitive(data.key)
  ) {
    if (!__WEEX__ || !('@binding' in data.key)) {
      warn(
        'Avoid using non-primitive value as key, ' +
        'use string/number value instead.',
        context
      )
    }
  }
  // support single function children as default scoped slot
  if (Array.isArray(children) &&
    typeof children[0] === 'function'
  ) {
    data = data || {}
    data.scopedSlots = { default: children[0] }
    children.length = 0
  }
  // 规范化子虚拟节点数组
  if (normalizationType === ALWAYS_NORMALIZE) {
    // 复杂的规范化处理方式（用户编写的`render`函数，必须使用此种方式）
    children = normalizeChildren(children)
  } else if (normalizationType === SIMPLE_NORMALIZE) {
    // 简单的规范化处理方式
    children = simpleNormalizeChildren(children)
  }
  let vnode, ns
  if (typeof tag === 'string') {
    // tag 为标签字符串：1、平台内置元素标签名称；2、全局/局部注册的组件名称

    let Ctor
    // 此时 context.$vnode 为 parentVnode，即先使用 parentVnode 的 ns
    ns = (context.$vnode && context.$vnode.ns) || config.getTagNamespace(tag)
    if (config.isReservedTag(tag)) {
      // platform built-in elements
      // 字符串类型一：平台内置元素标签（字符串），web 平台下包括 HTML 标签和 SVG 标签
      vnode = new VNode(
        config.parsePlatformTagName(tag), data, children,
        undefined, undefined, context
      )
    } else if (isDef(Ctor = resolveAsset(context.$options, 'components', tag))) {
      // component
      // 字符串类型二：局部注册的组件名称（包括继承、混合而来的）
      // Ctor 可能是继承 Vue 的构造函数，或者是组件选项对象
      vnode = createComponent(Ctor, data, context, children, tag)
    } else {
      // unknown or unlisted namespaced elements
      // check at runtime because it may get assigned a namespace when its
      // parent normalizes children
      // 未知元素/未列出命名空间的元素
      vnode = new VNode(
        tag, data, children,
        undefined, undefined, context
      )
    }
  } else {
    // tag 为 1、组件选项对象；2、构造函数；3、返回值为组件选项对象的异步函数

    // direct component options / constructor
    vnode = createComponent(tag, data, context, children)
  }
  if (Array.isArray(vnode)) {
    return vnode
  } else if (isDef(vnode)) {
    if (isDef(ns)) applyNS(vnode, ns)
    if (isDef(data)) registerDeepBindings(data)
    return vnode
  } else {
    return createEmptyVNode()
  }
}

function applyNS (vnode, ns, force) {
  vnode.ns = ns
  if (vnode.tag === 'foreignObject') {
    // use default namespace inside foreignObject
    ns = undefined
    force = true
  }
  if (isDef(vnode.children)) {
    for (let i = 0, l = vnode.children.length; i < l; i++) {
      const child = vnode.children[i]
      if (isDef(child.tag) && (
        isUndef(child.ns) || (isTrue(force) && child.tag !== 'svg'))) {
        applyNS(child, ns, force)
      }
    }
  }
}

// ref #5318
// necessary to ensure parent re-render when deep bindings like :style and
// :class are used on slot nodes
function registerDeepBindings (data) {
  if (isObject(data.style)) {
    traverse(data.style)
  }
  if (isObject(data.class)) {
    traverse(data.class)
  }
}
