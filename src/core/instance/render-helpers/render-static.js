/* @flow */

/**
 * Runtime helper for rendering static trees.
 *
 * 渲染静态节点树，生成 vnode 节点后，将 vnode 节点 缓存在 this._staticTrees 上，方便下次直接使用
 */
export function renderStatic (
  index: number,
  isInFor: boolean
): VNode | Array<VNode> {
  const cached = this._staticTrees || (this._staticTrees = [])
  let tree = cached[index]
  // 查看是否存在缓存的 VNode，若存在就直接返回
  // if has already-rendered static tree and not inside v-for,
  // we can reuse the same tree.
  if (tree && !isInFor) {
    return tree
  }
  // otherwise, render a fresh tree.
  // 渲染出 Vnode 节点
  tree = cached[index] = this.$options.staticRenderFns[index].call(
    this._renderProxy,
    null,
    this // for render fns generated for functional component templates
  )
  // 将 VNode 标记为静态的，并给个独立无二的 key
  markStatic(tree, `__static__${index}`, false)
  return tree
}

/**
 * Runtime helper for v-once.
 * Effectively it means marking the node as static with a unique key.
 */

/**
 * 将 VNode 标记为静态节点，并给个独立无二的 key
 */
export function markOnce (
  tree: VNode | Array<VNode>,
  index: number,
  key: string
) {
  markStatic(tree, `__once__${index}${key ? `_${key}` : ``}`, true)
  return tree
}

/**
 * 将 Vnode 或 Vnode 数组里的各个 Vnode 标记为静态的
 * 类似 v-for 的节点会产生 VNode 数组
 */
function markStatic (
  tree: VNode | Array<VNode>,
  key: string,
  isOnce: boolean
) {
  if (Array.isArray(tree)) {
    for (let i = 0; i < tree.length; i++) {
      if (tree[i] && typeof tree[i] !== 'string') {
        markStaticNode(tree[i], `${key}_${i}`, isOnce)
      }
    }
  } else {
    markStaticNode(tree, key, isOnce)
  }
}

/**
 * 将 Vnode 节点标记为静态的，并标记是否是带有 v-once 指令
 */
function markStaticNode (node, key, isOnce) {
  node.isStatic = true
  node.key = key
  node.isOnce = isOnce
}
