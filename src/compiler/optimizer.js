/* @flow */

import { makeMap, isBuiltInTag, cached, no } from 'shared/util'

let isStaticKey
let isPlatformReservedTag

const genStaticKeysCached = cached(genStaticKeys)

/**
 * Goal of the optimizer: walk the generated template AST tree
 * and detect sub-trees that are purely static, i.e. parts of
 * the DOM that never needs to change.
 *
 * Once we detect these sub-trees, we can:
 *
 * 1. Hoist them into constants, so that we no longer need to
 *    create fresh nodes for them on each re-render;
 * 2. Completely skip them in the patching process.
 *
 * 优化的目标：遍历由模板生成的 AST 树，检测子树是否是纯静态的，比如部分 DOM 从来不需要改变。
 *
 * 一旦我们检测到这些子树，我们可以：
 * 1. 将它们提升为常量，以便我们在每次重新渲染时不再创建新的节点
 * 2. 在`patch`过程中完全跳过它们
 */
export function optimize (root: ?ASTElement, options: CompilerOptions) {
  if (!root) return
  // 判断 key 是否是静态 key，带缓存功能
  isStaticKey = genStaticKeysCached(options.staticKeys || '')
  isPlatformReservedTag = options.isReservedTag || no
  // first pass: mark all non-static nodes.
  markStatic(root)
  // second pass: mark static roots.
  markStaticRoots(root, false)
}

function genStaticKeys (keys: string): Function {
  return makeMap(
    'type,tag,attrsList,attrsMap,plain,parent,children,attrs' +
    (keys ? ',' + keys : '')
  )
}

/**
 * 递归地确定元素是否是静态节点
 */
function markStatic (node: ASTNode) {
  node.static = isStatic(node)

  // 元素节点
  if (node.type === 1) {
    // do not make component slot content static. this avoids
    // 1. components not able to mutate slot nodes
    // 2. static slot content fails for hot-reloading
    if (
      !isPlatformReservedTag(node.tag) &&
      node.tag !== 'slot' &&
      node.attrsMap['inline-template'] == null
    ) {
      //针对非平台保留标签，并且不是 slot 元素节点，并且不是组件内联模板的元素节点
      // 不需要针对子元素及平级的条件元素来判断元素是否是静态的
      return
    }
    // 若子元素不是静态的，则父元素也不是静态的
    for (let i = 0, l = node.children.length; i < l; i++) {
      const child = node.children[i]
      markStatic(child)
      if (!child.static) {
        node.static = false
      }
    }
    // 若元素对应的条件元素不是静态的，则元素也不是静态的
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        const block = node.ifConditions[i].block
        markStatic(block)
        if (!block.static) {
          node.static = false
        }
      }
    }
  }
}

/**
 * 判断元素是否是静态的根节点（这里的根节点不是组件的根节点）
 * @param {*} node AST 元素
 * @param {*} isInFor 是否在 v-for 指令里，即祖先元素是否存在 v-for 特性
 */
function markStaticRoots (node: ASTNode, isInFor: boolean) {
  if (node.type === 1) {
    if (node.static || node.once) {
      node.staticInFor = isInFor
    }
    // For a node to qualify as a static root, it should have children that
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.
    // 策略：节点是静态的 && 节点有子元素 && 节点不能只有一个静态文本/注释子节点
    // 满足这三个条件才将该节点设置为 staticRoot
    if (node.static && node.children.length && !(
      node.children.length === 1 &&
      node.children[0].type === 3
    )) {
      node.staticRoot = true
      return
    } else {
      node.staticRoot = false
    }
    if (node.children) {
      for (let i = 0, l = node.children.length; i < l; i++) {
        markStaticRoots(node.children[i], isInFor || !!node.for)
      }
    }
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        markStaticRoots(node.ifConditions[i].block, isInFor)
      }
    }
  }
}

/**
 * 判断是否是静态的 AST node
 *
 * 1. 带有插值的文本节点，不是静态的
 * 2. 纯文本节点，是静态的
 * 3. 带有 v-pre 的元素节点，是静态的
 * 4. 符合以下全部条件的节点是静态的
 *    - 没有动态绑定的特性
 *    - 没有 v-if 指令
 *    - 没有 v-for 指令
 *    - 不是内置标签如 slot,component
 *    - 必须是平台保留的标签，针对浏览器端，就是 html 标签和 svg 标签等
 *    - 不是带有 v-for 指令的 template 元素的直接子元素
 *    - 节点上仅包含静态的 key 属性
 */
function isStatic (node: ASTNode): boolean {
  if (node.type === 2) { // expression
    // 带有插值的文本节点，不是静态的
    return false
  }
  if (node.type === 3) { // text
    // 纯文本，是静态的
    return true
  }
  return !!(node.pre || (
    // 没有动态绑定的特性，在 processAttrs 的时候会赋值
    !node.hasBindings && // no dynamic bindings
    !node.if && !node.for && // not v-if or v-for or v-else
    // 不是内置标签如 slot,component
    !isBuiltInTag(node.tag) && // not a built-in
    // 是平台保留的标签，针对浏览器端，就是 html 标签和 svg 标签等
    isPlatformReservedTag(node.tag) && // not a component
    // 不是带有 v-for 的 template 元素的直接子元素
    !isDirectChildOfTemplateFor(node) &&
    // 元素拥有的所有属性都是静态的，比如：
    // 1、staticClass,staticStyle
    // 2、type,tag,attrsList,attrsMap,plain,parent,children,attrs
    Object.keys(node).every(isStaticKey)
  ))
}

/**
 * 判断元素是否是带有 v-for 的 template 元素的直接子元素
 */
function isDirectChildOfTemplateFor (node: ASTElement): boolean {
  while (node.parent) {
    node = node.parent
    if (node.tag !== 'template') {
      return false
    }
    if (node.for) {
      return true
    }
  }
  return false
}
