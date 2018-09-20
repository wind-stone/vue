/* @flow */

import { getStyle, normalizeStyleBinding } from 'web/util/style'
import { cached, camelize, extend, isDef, isUndef } from 'shared/util'

const cssVarRE = /^--/
const importantRE = /\s*!important$/

/**
 * 设置 el.style 属性
 *
 * @param {*} el 元素
 * @param {*} name css 属性名
 * @param {*} val css 属性值
 */
const setProp = (el, name, val) => {
  /* istanbul ignore if */
  if (cssVarRE.test(name)) {
    el.style.setProperty(name, val)
  } else if (importantRE.test(val)) {
    el.style.setProperty(name, val.replace(importantRE, ''), 'important')
  } else {
    const normalizedName = normalize(name)
    if (Array.isArray(val)) {
      // Support values array created by autoprefixer, e.g.
      // {display: ["-webkit-box", "-ms-flexbox", "flex"]}
      // Set them one by one, and the browser will only set those it can recognize
      for (let i = 0, len = val.length; i < len; i++) {
        el.style[normalizedName] = val[i]
      }
    } else {
      el.style[normalizedName] = val
    }
  }
}

const vendorNames = ['Webkit', 'Moz', 'ms']

let emptyStyle

/**
 * 标准化 property 的名称
 */
const normalize = cached(function (prop) {
  emptyStyle = emptyStyle || document.createElement('div').style
  prop = camelize(prop)
  if (prop !== 'filter' && (prop in emptyStyle)) {
    return prop
  }
  const capName = prop.charAt(0).toUpperCase() + prop.slice(1)
  for (let i = 0; i < vendorNames.length; i++) {
    const name = vendorNames[i] + capName
    if (name in emptyStyle) {
      return name
    }
  }
})

/**
 * 更新 DOM 元素节点的 style 特性
 */
function updateStyle (oldVnode: VNodeWithData, vnode: VNodeWithData) {
  const data = vnode.data
  const oldData = oldVnode.data

  if (isUndef(data.staticStyle) && isUndef(data.style) &&
    isUndef(oldData.staticStyle) && isUndef(oldData.style)
  ) {
    // 若新旧 VNode 都不存在 style/staticStyle 属性，则无需更新，直接返回
    return
  }

  let cur, name
  const el: any = vnode.elm
  const oldStaticStyle: any = oldData.staticStyle
  const oldStyleBinding: any = oldData.normalizedStyle || oldData.style || {}

  // if static style exists, stylebinding already merged into it when doing normalizeStyleData
  // 若是 staticStyle 存在，就使用 staticStyle
  // 因为 stylebinding 的数据已经在 getStyle 时通过 normalizeStyleData 合并到 stylebinding 了
  const oldStyle = oldStaticStyle || oldStyleBinding

  // 将 vnode.data.style 规范化成对象形式的 style
  const style = normalizeStyleBinding(vnode.data.style) || {}

  // store normalized style under a different key for next diff
  // make sure to clone it if it's reactive, since the user likely wants
  // to mutate it.
  // 若 style 是响应式的，克隆一份数据
  vnode.data.normalizedStyle = isDef(style.__ob__)
    ? extend({}, style)
    : style

  // 合并新 VNode 上的 style 和 staticStyle，形成最终的对象形式的 style（包括向上向下处理连续嵌套组件的情况）
  const newStyle = getStyle(vnode, true)

  // 删除不在新 style 里的老 style 属性
  for (name in oldStyle) {
    if (isUndef(newStyle[name])) {
      setProp(el, name, '')
    }
  }
  // 将新 style 设置到 DOM 元素节点上
  for (name in newStyle) {
    cur = newStyle[name]
    if (cur !== oldStyle[name]) {
      // ie9 setting to null has no effect, must use empty string
      setProp(el, name, cur == null ? '' : cur)
    }
  }
}

export default {
  create: updateStyle,
  update: updateStyle
}
