/* @flow */

/**
 * In SSR, the vdom tree is generated only once and never patched, so
 * we can optimize most element / trees into plain string render functions.
 * The SSR optimizer walks the AST tree to detect optimizable elements and trees.
 *
 * The criteria for SSR optimizability is quite a bit looser than static tree
 * detection (which is designed for client re-render). In SSR we bail only for
 * components/slots/custom directives.
 */

import { no, makeMap, isBuiltInTag } from 'shared/util'

// 节点的优化能力:
// optimizability constants
export const optimizability = {
  // 整个子树都不能优化
  FALSE: 0,    // whole sub tree un-optimizable
  // 整个子树都能优化
  FULL: 1,     // whole sub tree optimizable
  // 根节点能优化,但是部分子节点不能优化
  SELF: 2,     // self optimizable but has some un-optimizable children
  // 根节点不能优化,但是所有子节点都能优化
  CHILDREN: 3, // self un-optimizable but have fully optimizable children
  // 根节点不能优化,但是部分子节点不能优化
  PARTIAL: 4   // self un-optimizable with some un-optimizable children
}

let isPlatformReservedTag

/**
 * 标记 AST Tree 里可优化的节点
 */
export function optimize (root: ?ASTElement, options: CompilerOptions) {
  if (!root) return
  isPlatformReservedTag = options.isReservedTag || no
  walk(root, true)
}

function walk (node: ASTNode, isRoot?: boolean) {
  if (isUnOptimizableTree(node)) {
    // 若是不可进行优化，则直接返回
    node.ssrOptimizability = optimizability.FALSE
    return
  }

  // 判断节点自身是否不可优化
  // root node or nodes with custom directives should always be a VNode
  const selfUnoptimizable = isRoot || hasCustomDirective(node)

  // 确定节点的优化能力
  const check = child => {
    if (child.ssrOptimizability !== optimizability.FULL) {
      node.ssrOptimizability = selfUnoptimizable
        ? optimizability.PARTIAL
        : optimizability.SELF
    }
  }
  if (selfUnoptimizable) {
    // 若自身不可优化，先假设其全部自己能优化（后面在 walk 子节点之后,再根据子节点的优化情况，确定父节点的优化情况）
    node.ssrOptimizability = optimizability.CHILDREN
  }
  if (node.type === 1) {
    // 若是元素节点
    for (let i = 0, l = node.children.length; i < l; i++) {
      const child = node.children[i]
      // 递归地优化 VNode 的子节点
      walk(child)
      // 根据子节点的优化能力,判断根节点的优化能力
      check(child)
    }
    if (node.ifConditions) {
      // 若节点是带有 v-if 的节点，则遍历其后的 v-else/v-else-if 节点进行优化
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        const block = node.ifConditions[i].block
        walk(block, isRoot)
        check(block)
      }
    }
    if (node.ssrOptimizability == null ||
      (!isRoot && (node.attrsMap['v-html'] || node.attrsMap['v-text']))
    ) {
      // node.ssrOptimizability == null: 若节点自身是可优化的 && 所有子节点（可能没有子节点）都能优化且条件节点（可能没有条件节点）也都能优化
      // !isRoot && (node.attrsMap['v-html'] || node.attrsMap['v-text']): 节点不是根节点 && 节点有 v-html 或 v-text 指令
      // 则该节点的整个子树都能优化
      node.ssrOptimizability = optimizability.FULL
    } else {
      // 优化子节点
      node.children = optimizeSiblings(node)
    }
  } else {
    node.ssrOptimizability = optimizability.FULL
  }
}

/**
 * 优化子节点，优化的结果是：
 *
 * 所有可全部优化的相邻子节点会合并到一个 template 标签里，不可全部优化的子节点单独成为一个子节点
 * 注意：经过这一步优化之后，相邻子节点的顺序保持不变
 *
 * 假设传入的 el.children 是 [a, b, c, d, e, f]，且 a、b、d、e 是可全部优化的子节点，则最终返回的 optimizedChildren 的结构为：
 * [
 *   {
 *      // 省略了其他属性，仅保留 tag 和 children
 *      tag: 'template',
 *      children: [a, b]
 *   },
 *   c,
 *   {
 *      tag: 'template',
 *      children: [d, e]
 *   },
 *   f
 * ]
 */
function optimizeSiblings (el) {
  const children = el.children
  // 存放已经优化过的子节点
  const optimizedChildren = []

  // 存放当前待优化的节点
  let currentOptimizableGroup = []
  const pushGroup = () => {
    // 将所有的可全部优化的相邻节点封装到 template 标签里，以便它们可以在 codegen 节点优化到一个 ssrNode 里
    if (currentOptimizableGroup.length) {
      optimizedChildren.push({
        type: 1,
        parent: el,
        tag: 'template',
        attrsList: [],
        attrsMap: {},
        rawAttrsMap: {},
        children: currentOptimizableGroup,
        ssrOptimizability: optimizability.FULL
      })
    }
    currentOptimizableGroup = []
  }

  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    if (c.ssrOptimizability === optimizability.FULL) {
      // 若子节点的子树可以全部优化，添加到待优化列表里
      currentOptimizableGroup.push(c)
    } else {
      // wrap fully-optimizable adjacent siblings inside a template tag
      // so that they can be optimized into a single ssrNode by codegen
      pushGroup()
      optimizedChildren.push(c)
    }
  }
  pushGroup()
  return optimizedChildren
}

function isUnOptimizableTree (node: ASTNode): boolean {
  if (node.type === 2 || node.type === 3) { // text or expression
    return false
  }
  return (
    isBuiltInTag(node.tag) || // built-in (slot, component)
    !isPlatformReservedTag(node.tag) || // custom component
    !!node.component || // "is" component
    isSelectWithModel(node) // <select v-model> requires runtime inspection
  )
}

const isBuiltInDir = makeMap('text,html,show,on,bind,model,pre,cloak,once')

function hasCustomDirective (node: ASTNode): ?boolean {
  return (
    node.type === 1 &&
    node.directives &&
    node.directives.some(d => !isBuiltInDir(d.name))
  )
}

// <select v-model> cannot be optimized because it requires a runtime check
// to determine proper selected option
function isSelectWithModel (node: ASTNode): boolean {
  return (
    node.type === 1 &&
    node.tag === 'select' &&
    node.directives != null &&
    node.directives.some(d => d.name === 'model')
  )
}
