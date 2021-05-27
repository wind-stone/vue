/* @flow */

import { warn, extend, isPlainObject } from 'core/util/index'

/**
 * 生成 render 函数时，（处理指令时）将 v-on 指令里指令名称和回调放到 VNodeData.on 上，而不是 data.directives
 */
export function bindObjectListeners (data: any, value: any): VNodeData {
  if (value) {
    if (!isPlainObject(value)) {
      process.env.NODE_ENV !== 'production' && warn(
        'v-on without argument expects an Object value',
        this
      )
    } else {
      const on = data.on = data.on ? extend({}, data.on) : {}
      for (const key in value) {
        const existing = on[key]
        const ours = value[key]
        on[key] = existing ? [].concat(existing, ours) : ours
      }
    }
  }
  return data
}
