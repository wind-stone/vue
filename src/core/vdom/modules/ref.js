/* @flow */

import { remove, isDef } from 'shared/util'

export default {
  create (_: any, vnode: VNodeWithData) {
    // 添加新的 ref
    registerRef(vnode)
  },
  update (oldVnode: VNodeWithData, vnode: VNodeWithData) {
    if (oldVnode.data.ref !== vnode.data.ref) {
      // 删除老的 ref
      registerRef(oldVnode, true)
      // 添加新的 ref
      registerRef(vnode)
    }
  },
  destroy (vnode: VNodeWithData) {
    // 删除老的 ref
    registerRef(vnode, true)
  }
}

/**
 * 在 context 组件实例上注册/删除元素/组件的 ref
 * @param {*} vnode 组件的 vnode
 * @param {*} isRemoval 是否删除 context 上该元素/组件对应的 ref
 */
export function registerRef (vnode: VNodeWithData, isRemoval: ?boolean) {
  const key = vnode.data.ref
  if (!isDef(key)) return

  const vm = vnode.context
  const ref = vnode.componentInstance || vnode.elm
  const refs = vm.$refs
  if (isRemoval) {
    if (Array.isArray(refs[key])) {
      remove(refs[key], ref)
    } else if (refs[key] === ref) {
      refs[key] = undefined
    }
  } else {
    if (vnode.data.refInFor) {
      if (!Array.isArray(refs[key])) {
        refs[key] = [ref]
      } else if (refs[key].indexOf(ref) < 0) {
        // $flow-disable-line
        refs[key].push(ref)
      }
    } else {
      refs[key] = ref
    }
  }
}
