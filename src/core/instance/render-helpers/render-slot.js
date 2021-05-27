/* @flow */

import { extend, warn, isObject } from 'core/util/index'

/**
 * Runtime helper for rendering <slot>
 */
export function renderSlot (
  name: string,
  // slot 标签内的子节点，即后备内容，若该 slot 没有分发内容，则显示后备内容
  fallback: ?Array<VNode>,
  props: ?Object,
  bindObject: ?Object
): ?Array<VNode> {
  // 子组件标签上的 scopedSlots 会挂载到子组件实例 $scopedSlots 上，因此在这里可以取到 slot 标签的 render 函数
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
      // 将 slot 标签上的特性都合并在一起
      props = extend(extend({}, bindObject), props)
    }
    // 调用作用域插槽的 render 函数生成 VNode 节点
    nodes = scopedSlotFn(props) || fallback
  } else {
    // 这里是为了兼容 v2.6.0 以前的旧语法
    nodes = this.$slots[name] || fallback
  }

  const target = props && props.slot
  if (target) {
    // 这里是为了兼容 v2.6.0 以前的旧语法
    return this.$createElement('template', { slot: target }, nodes)
  } else {
    // 作用域插槽
    return nodes
  }
}
