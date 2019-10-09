/* @flow */

import { extend, warn, isObject } from 'core/util/index'

/**
 * Runtime helper for rendering <slot>
 * 返回子组件里 slot 元素节点的 VNode 数组
 */
export function renderSlot (
  // 插槽的名称
  name: string,
  // fallback 是 slot 标签内的插槽默认内容的 VNode 数组。若该 slot 没有分发内容，则使用默认内容
  fallback: ?Array<VNode>,
  // slot 元素上的特性对象
  props: ?Object,
  // v-bind 指令的值，对象类型
  bindObject: ?Object
): ?Array<VNode> {
  const scopedSlotFn = this.$scopedSlots[name]
  let nodes
  if (scopedSlotFn) { // scoped slot
    props = props || {}
    if (bindObject) {
      if (process.env.NODE_ENV !== 'production' && !isObject(bindObject)) {
        warn(
          'slot v-bind without argument expects an Object',
          this
        )
      }
      // 合并 v-bind 特性对象和零散的特性
      props = extend(extend({}, bindObject), props)
    }
    // 生成 vnode 节点
    nodes = scopedSlotFn(props) || fallback
  } else {
    const slotNodes = this.$slots[name]
    // warn duplicate slot usage
    if (slotNodes) {
      if (process.env.NODE_ENV !== 'production' && slotNodes._rendered) {
        warn(
          `Duplicate presence of slot "${name}" found in the same render tree ` +
          `- this will likely cause render errors.`,
          this
        )
      }
      slotNodes._rendered = true
    }
    nodes = slotNodes || fallback
  }

  // target 为 slot 的名称，仅在节点 tag 为 template 下才有 slot 属性
  // 使用 template 的原因是，插槽的默认内容可以是多个元素
  const target = props && props.slot
  if (target) {
    // 一般插槽：生成分发内容的 VNode，target 为要分发到的 slot 名称
    return this.$createElement('template', { slot: target }, nodes)
  } else {
    // 作用域插槽
    return nodes
  }
}
