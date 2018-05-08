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
 */
export function optimize (root: ?ASTElement, options: CompilerOptions) {
  if (!root) return
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
 * 递归地确定元素是否是静态的
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

function markStaticRoots (node: ASTNode, isInFor: boolean) {
  if (node.type === 1) {
    if (node.static || node.once) {
      node.staticInFor = isInFor
    }
    // For a node to qualify as a static root, it should have children that
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.
    // 策略：节点是静态的 && 节点有子元素 && 节点不能只有一个文本子元素
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
 */
function isStatic (node: ASTNode): boolean {
  if (node.type === 2) { // expression
    // 包含插值处理之后的表达式
    return false
  }
  if (node.type === 3) { // text
    // 纯文本
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
