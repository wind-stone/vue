/* @flow */

import { cached, extend, toObject } from 'shared/util'

/**
 * 解析 html 标签上 style 属性里的各个声明，转换成对象格式
 * @return {Object} {声明的属性: 声明的值}
 */
export const parseStyleText = cached(function (cssText) {
  const res = {}
  // 匹配 css 声明之间分隔的 ;
  // 正向否定查找，匹配分号“;”，仅当“;”后面不跟着某个表达式
  // 这个表达式是：[^(]*\)，即非(的零到多个字符且以)结尾，TODO: 这是什么情况下的？
  const listDelimiter = /;(?![^(]*\))/g
  // 匹配声明里属性和值之间分隔的 :
  const propertyDelimiter = /:(.+)/
  cssText.split(listDelimiter).forEach(function (item) {
    if (item) {
      var tmp = item.split(propertyDelimiter)
      tmp.length > 1 && (res[tmp[0].trim()] = tmp[1].trim())
    }
  })
  return res
})

// merge static and dynamic style data on the same vnode
/**
 * 合并同一 VNode 节点上的 style 和 staticStyle，返回新的对象形式的 style
 */
function normalizeStyleData (data: VNodeData): ?Object {
  const style = normalizeStyleBinding(data.style)
  // static style is pre-processed into an object during compilation
  // and is always a fresh object, so it's safe to merge into it
  // 编译阶段已经将 staticStyle 预处理成了对象形式，而且这个对象是新的引用
  return data.staticStyle
    ? extend(data.staticStyle, style)
    : style
}

// normalize possible array / string values into Object
/**
 * 规格化数组/字符串形式的 style 为对象形式
 */
export function normalizeStyleBinding (bindingStyle: any): ?Object {
  if (Array.isArray(bindingStyle)) {
    // 将对象数组合并为单个对象，如 [{a: 1}, {b: 2}] --> {a: 1, b: 2}
    return toObject(bindingStyle)
  }
  if (typeof bindingStyle === 'string') {
    // 将字符串形式的 style 转为对象
    return parseStyleText(bindingStyle)
  }
  // 对象形式的 style，直接返回
  return bindingStyle
}

/**
 * parent component style should be after child's
 * so that parent component's style could override it
 */
/**
 * 合并新 VNode 上的 style 和 staticStyle，形成最终的对象形式的 style（包括向上向下处理连续嵌套组件的情况）
 */
export function getStyle (vnode: VNodeWithData, checkChild: boolean): Object {
  const res = {}
  let styleData
  // 若该 VNode 是组件占位 VNode，则先合并子组件渲染 VNode 根元素的 style，包括连续嵌套组件
  if (checkChild) {
    let childNode = vnode
    while (childNode.componentInstance) {
      childNode = childNode.componentInstance._vnode
      if (
        childNode && childNode.data &&
        (styleData = normalizeStyleData(childNode.data))
      ) {
        extend(res, styleData)
      }
    }
  }

  // 再合并该 VNode 的 style
  if ((styleData = normalizeStyleData(vnode.data))) {
    extend(res, styleData)
  }

  let parentNode = vnode
  // 若该 VNode 是组件渲染 VNode，则最后合并父组件占位 VNode 上的 style，包括连续嵌套组件
  while ((parentNode = parentNode.parent)) {
    if (parentNode.data && (styleData = normalizeStyleData(parentNode.data))) {
      extend(res, styleData)
    }
  }
  return res
}
