/* @flow */

import he from 'he'
import { parseHTML } from './html-parser'
import { parseText } from './text-parser'
import { parseFilters } from './filter-parser'
import { genAssignmentCode } from '../directives/model'
import { extend, cached, no, camelize } from 'shared/util'
import { isIE, isEdge, isServerRendering } from 'core/util/env'

import {
  addProp,
  addAttr,
  baseWarn,
  addHandler,
  addDirective,
  getBindingAttr,
  getAndRemoveAttr,
  pluckModuleFunction
} from '../helpers'

export const onRE = /^@|^v-on:/
export const dirRE = /^v-|^@|^:/
export const forAliasRE = /([^]*?)\s+(?:in|of)\s+([^]*)/
export const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
const stripParensRE = /^\(|\)$/g

const argRE = /:(.*)$/
export const bindRE = /^:|^v-bind:/
const modifierRE = /\.[^.]+/g

const decodeHTMLCached = cached(he.decode)

// configurable state
export let warn: any
let delimiters
let transforms
let preTransforms
let postTransforms
let platformIsPreTag
let platformMustUseProp
let platformGetTagNamespace

type Attr = { name: string; value: string };

export function createASTElement (
  tag: string,
  attrs: Array<Attr>,
  parent: ASTElement | void
): ASTElement {
  return {
    type: 1,
    tag,
    attrsList: attrs,
    attrsMap: makeAttrsMap(attrs),
    parent,
    children: []
  }
}

/**
 * Convert HTML string to AST.
 */
export function parse (
  template: string,
  options: CompilerOptions
): ASTElement | void {
  warn = options.warn || baseWarn

  // 判断是否是 pre 标签
  platformIsPreTag = options.isPreTag || no
  platformMustUseProp = options.mustUseProp || no
  platformGetTagNamespace = options.getTagNamespace || no

  // 获取每个 modules 对应的 transformNode、preTransformNode、postTransformNode 函数
  transforms = pluckModuleFunction(options.modules, 'transformNode')
  preTransforms = pluckModuleFunction(options.modules, 'preTransformNode')
  postTransforms = pluckModuleFunction(options.modules, 'postTransformNode')

  delimiters = options.delimiters

  const stack = []
  const preserveWhitespace = options.preserveWhitespace !== false
  let root
  let currentParent
  let inVPre = false
  let inPre = false
  let warned = false

  function warnOnce (msg) {
    if (!warned) {
      warned = true
      warn(msg)
    }
  }

  /**
   * 关闭元素、清理 inVPre、inPre 标记，调用各模块的 postTransformNode 函数
   */
  function closeElement (element) {
    // check pre state
    if (element.pre) {
      inVPre = false
    }
    if (platformIsPreTag(element.tag)) {
      inPre = false
    }
    // apply post-transforms
    for (let i = 0; i < postTransforms.length; i++) {
      postTransforms[i](element, options)
    }
  }

  parseHTML(template, {
    warn,
    expectHTML: options.expectHTML,
    isUnaryTag: options.isUnaryTag,
    canBeLeftOpenTag: options.canBeLeftOpenTag,
    shouldDecodeNewlines: options.shouldDecodeNewlines,
    shouldDecodeNewlinesForHref: options.shouldDecodeNewlinesForHref,
    shouldKeepComment: options.comments,

    /**
     * 处理开始标签：创建 AST 元素，处理指令、事件、特性等等，最后压入栈中
     * @param {String} tag 元素的标签名
     * @param {Array} attrs 特性对象数组，形如 [{ name, value }, ...]
     * @param {Boolean} unary 是否是一元标签
     */
    start (tag, attrs, unary) {
      // check namespace.
      // inherit parent ns if there is one
      const ns = (currentParent && currentParent.ns) || platformGetTagNamespace(tag)

      // handle IE svg bug
      /* istanbul ignore if */
      if (isIE && ns === 'svg') {
        attrs = guardIESVGBug(attrs)
      }

      // 创建 AST 元素
      let element: ASTElement = createASTElement(tag, attrs, currentParent)
      if (ns) {
        element.ns = ns
      }

      if (isForbiddenTag(element) && !isServerRendering()) {
        // 模板内不能存在 style 和 type 为 text/javascript 的 script 标签
        element.forbidden = true
        process.env.NODE_ENV !== 'production' && warn(
          'Templates should only be responsible for mapping the state to the ' +
          'UI. Avoid placing tags with side-effects in your templates, such as ' +
          `<${tag}>` + ', as they will not be parsed.'
        )
      }

      // apply pre-transforms
      // 转换前的预处理，比如：input 元素上具有 v-model 指令并且 type 是动态绑定的情况
      for (let i = 0; i < preTransforms.length; i++) {
        element = preTransforms[i](element, options) || element
      }

      if (!inVPre) {
        processPre(element)
        // 存在 v-pre 特性
        if (element.pre) {
          inVPre = true
        }
      }
      // 判断是否是 pre 标签
      if (platformIsPreTag(element.tag)) {
        inPre = true
      }
      if (inVPre) {
        // 若元素有 v-pre 指令，则处理原生的特性
        processRawAttrs(element)
      } else if (!element.processed) {
        // structural directives
        processFor(element)
        processIf(element)
        processOnce(element)
        // element-scope stuff
        processElement(element, options)
      }

      /**
       * 检查 AST 根节点是否满足约束条件
       *
       * 1. 根节点不能是 slot/template 标签
       * 2. 根节点上不能有 v-for 指令
       *
       * 上述这两个都可能导致存在多个根节点的情况
       */
      function checkRootConstraints (el) {
        if (process.env.NODE_ENV !== 'production') {
          if (el.tag === 'slot' || el.tag === 'template') {
            warnOnce(
              `Cannot use <${el.tag}> as component root element because it may ` +
              'contain multiple nodes.'
            )
          }
          if (el.attrsMap.hasOwnProperty('v-for')) {
            warnOnce(
              'Cannot use v-for on stateful component root element because ' +
              'it renders multiple elements.'
            )
          }
        }
      }

      // tree management
      // 设置 AST 树的根节点
      // 非生产环境下，检查约束条件
      if (!root) {
        root = element
        checkRootConstraints(root)
      } else if (!stack.length) {
        // root 存在 && 栈为空，说明 element 是跟 root 平级的节点
        // allow root elements with v-if, v-else-if and v-else
        if (root.if && (element.elseif || element.else)) {
          checkRootConstraints(element)
          addIfCondition(root, {
            exp: element.elseif,
            block: element
          })
        } else if (process.env.NODE_ENV !== 'production') {
          warnOnce(
            `Component template should contain exactly one root element. ` +
            `If you are using v-if on multiple elements, ` +
            `use v-else-if to chain them instead.`
          )
        }
      }
      if (currentParent && !element.forbidden) {
        if (element.elseif || element.else) {
          // 处理元素带有 v-else-if/v-else 指令的情况
          processIfConditions(element, currentParent)
        } else if (element.slotScope) { // scoped slot
          // 将作用域插槽放入父元素的 scopedSlots 里，而不是作为父元素的 child
          currentParent.plain = false
          const name = element.slotTarget || '"default"'
          ;(currentParent.scopedSlots || (currentParent.scopedSlots = {}))[name] = element
        } else {
          // 作为父节点的子节点
          currentParent.children.push(element)
          element.parent = currentParent
        }
      }
      if (!unary) {
        // 非一元标签，推入栈中，更新 currentParent
        currentParent = element
        stack.push(element)
      } else {
        // 一元标签，关闭元素
        closeElement(element)
      }
    },

    /**
     * 处理关闭标签（仅针对非一元标签）：元素出栈，再做一些清理工作
     */
    end () {
      // remove trailing whitespace
      const element = stack[stack.length - 1]
      const lastNode = element.children[element.children.length - 1]
      if (lastNode && lastNode.type === 3 && lastNode.text === ' ' && !inPre) {
        // 若节点的最后一个子节点是空格文本节点，则删除
        element.children.pop()
      }
      // pop stack
      stack.length -= 1
      currentParent = stack[stack.length - 1]
      closeElement(element)
    },

    /**
     * 处理文本内容
     */
    chars (text: string) {
      if (!currentParent) {
        // 不存在父节点，警告
        if (process.env.NODE_ENV !== 'production') {
          if (text === template) {
            warnOnce(
              'Component template requires a root element, rather than just text.'
            )
          } else if ((text = text.trim())) {
            warnOnce(
              `text "${text}" outside root element will be ignored.`
            )
          }
        }
        return
      }
      // IE textarea placeholder bug
      /* istanbul ignore if */
      if (isIE &&
        currentParent.tag === 'textarea' &&
        currentParent.attrsMap.placeholder === text
      ) {
        return
      }
      const children = currentParent.children
      text = inPre || text.trim()
        // 若是 script、style 里的文本，则不需要对做 html 解码；否则，解码
        ? isTextTag(currentParent) ? text : decodeHTMLCached(text)
        // only preserve whitespace if its not right after a starting tag
        : preserveWhitespace && children.length ? ' ' : ''
      if (text) {
        let res
        if (!inVPre && text !== ' ' && (res = parseText(text, delimiters))) {
          // 带插值的文本节点
          children.push({
            type: 2,
            expression: res.expression,
            tokens: res.tokens,
            text
          })
        } else if (text !== ' ' || !children.length || children[children.length - 1].text !== ' ') {
          // 静态文本节点
          children.push({
            type: 3,
            // text 可能为 ' '
            text
          })
        }
      }
    },
    comment (text: string) {
      // 静态注释节点
      currentParent.children.push({
        type: 3,
        text,
        isComment: true
      })
    }
  })

  // 返回 AST 根节点
  return root
}

/**
 * 处理 v-pre 特性，若有，ASTElement 上添加 pre 属性为 true
 */
function processPre (el) {
  if (getAndRemoveAttr(el, 'v-pre') != null) {
    el.pre = true
  }
}

function processRawAttrs (el) {
  const l = el.attrsList.length
  if (l) {
    const attrs = el.attrs = new Array(l)
    for (let i = 0; i < l; i++) {
      attrs[i] = {
        name: el.attrsList[i].name,
        value: JSON.stringify(el.attrsList[i].value)
      }
    }
  } else if (!el.pre) {
    // non root node in pre blocks with no attributes
    el.plain = true
  }
}


/**
 * 处理元素上特性，包括：key、ref、slot、is、inline-template 等
 *
 * ASTElement 元素上新增如下属性
 * {
 *   key,
 *   ref,
 *   refInFor,  // Boolean，若有 ref，该值表明该元素是否存在某个有 v-for 的祖先元素里
 *
 *   attrs, // Array，数组元素为对象：{ name, value }
 *   component, // 动态组件 is 的值
 *   inlineTemplate, // 是否是内联模板
 * }
 */
export function processElement (element: ASTElement, options: CompilerOptions) {
  processKey(element)

  // determine whether this is a plain element after
  // removing structural attributes
  element.plain = !element.key && !element.attrsList.length

  processRef(element)
  processSlot(element)
  // 处理组件标签里的 动态组件 和 内联模板
  processComponent(element)
  // 调用各模块的 transformNode 函数
  for (let i = 0; i < transforms.length; i++) {
    element = transforms[i](element, options) || element
  }
  // 处理 attributes，包括指令和非指令
  processAttrs(element)
}

/**
 * 获取 key 的值，添加到 AST 元素上
 */
function processKey (el) {
  const exp = getBindingAttr(el, 'key')
  if (exp) {
    if (process.env.NODE_ENV !== 'production' && el.tag === 'template') {
      warn(`<template> cannot be keyed. Place the key on real elements instead.`)
    }
    el.key = exp
  }
}

/**
 * 获取 ref 的值，添加到 AST 元素上
 */
function processRef (el) {
  const ref = getBindingAttr(el, 'ref')
  if (ref) {
    el.ref = ref
    el.refInFor = checkInFor(el)
  }
}

/**
 * 处理 v-for，将结果添加到 AST 元素里
 */
export function processFor (el: ASTElement) {
  let exp
  if ((exp = getAndRemoveAttr(el, 'v-for'))) {
    const res = parseFor(exp)
    if (res) {
      extend(el, res)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `Invalid v-for expression: ${exp}`
      )
    }
  }
}

type ForParseResult = {
  for: string;
  alias: string;
  iterator1?: string;
  iterator2?: string;
};


/**
 * 解析 v-for 里的值，返回解析结果
 * {
 *   for: xxx,        // 要循环的 数组 或 对象
 *   alias: xxx,      // value
 *   iterator1: xxx,  // key
 *   iterator2: xxx   // index
 * }
 *
 * 主要用三种形式（in 和 of 都行）：
 * 1. value in object/array/number
 * 2. (value, key) in object/array/number
 * 3. (value, key, index) in object
 */
export function parseFor (exp: string): ?ForParseResult {
  // forAliasRE = /([^]*?)\s+(?:in|of)\s+([^]*)/         匹配整个 v-for 里的值
  // stripParensRE = /^\(|\)$/g                          匹配 ( 和 )
  // forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
  const inMatch = exp.match(forAliasRE)
  if (!inMatch) return
  const res = {}
  res.for = inMatch[2].trim()
  const alias = inMatch[1].trim().replace(stripParensRE, '')
  const iteratorMatch = alias.match(forIteratorRE)
  if (iteratorMatch) {
    // 匹配形式 2 和形式 3
    // value
    res.alias = alias.replace(forIteratorRE, '')
    // key
    res.iterator1 = iteratorMatch[1].trim()
    if (iteratorMatch[2]) {
      // index
      res.iterator2 = iteratorMatch[2].trim()
    }
  } else {
    res.alias = alias
  }
  return res
}

/**
 * 处理 v-if、v-else、v-else-if 特性，在 ASTElement 上添加 if、else、ifElse 属性
 */
function processIf (el) {
  const exp = getAndRemoveAttr(el, 'v-if')
  if (exp) {
    el.if = exp
    addIfCondition(el, {
      exp: exp,
      block: el
    })
  } else {
    if (getAndRemoveAttr(el, 'v-else') != null) {
      el.else = true
    }
    const elseif = getAndRemoveAttr(el, 'v-else-if')
    if (elseif) {
      el.elseif = elseif
    }
  }
}

/**
 * 处理带有 v-elseif 和 v-else 的元素，查找对应的 v-if 的元素
 */
function processIfConditions (el, parent) {
  const prev = findPrevElement(parent.children)
  if (prev && prev.if) {
    addIfCondition(prev, {
      exp: el.elseif,
      block: el
    })
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `v-${el.elseif ? ('else-if="' + el.elseif + '"') : 'else'} ` +
      `used on element <${el.tag}> without corresponding v-if.`
    )
  }
}

function findPrevElement (children: Array<any>): ASTElement | void {
  let i = children.length
  while (i--) {
    if (children[i].type === 1) {
      return children[i]
    } else {
      if (process.env.NODE_ENV !== 'production' && children[i].text !== ' ') {
        warn(
          `text "${children[i].text.trim()}" between v-if and v-else(-if) ` +
          `will be ignored.`
        )
      }
      children.pop()
    }
  }
}

export function addIfCondition (el: ASTElement, condition: ASTIfCondition) {
  if (!el.ifConditions) {
    el.ifConditions = []
  }
  el.ifConditions.push(condition)
}

/**
 * 处理 v-once 特性
 *
 * 只渲染元素和组件一次。随后的重新渲染，元素/组件及其所有的子节点将被视为静态内容并跳过
 */
function processOnce (el) {
  const once = getAndRemoveAttr(el, 'v-once')
  if (once != null) {
    el.once = true
  }
}

/**
 * 处理 slot 相关，分为两类：
 * 1. 子组件模板里的 slot 占位标签（会将父组件对应的 slot 内容填充进去）
 *   - 最终增加 el.slotName 属性
 * 2. 父组件模板里子组件标签内的插槽元素，包括 slot、scope/slot-scope
 *   - 最终增加 el.slotTarget 属性，对应子组件模板里 slot 占位标签的 name
 *   - （可选的）增加 el.slotScope 属性，表明这个是作用域插槽
 */
function processSlot (el) {
  if (el.tag === 'slot') {
    // 子组件模板里的 slot 占位标签
    el.slotName = getBindingAttr(el, 'name')
    if (process.env.NODE_ENV !== 'production' && el.key) {
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
        `and can possibly expand into multiple elements. ` +
        `Use the key on a wrapping element instead.`
      )
    }
  } else {
    // 父组件模板里子组件标签内的插槽元素

    let slotScope

    // 处理作用于插槽 slot-scope
    if (el.tag === 'template') {
      // 示例：
      // <template slot-scope="props">
      //   <span>hello from parent</span>
      //   <span>{{ props.text }}</span>
      // </template>
      slotScope = getAndRemoveAttr(el, 'scope')
      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' && slotScope) {
        warn(
          `the "scope" attribute for scoped slots have been deprecated and ` +
          `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
          `can also be used on plain elements in addition to <template> to ` +
          `denote scoped slots.`,
          true
        )
      }
      el.slotScope = slotScope || getAndRemoveAttr(el, 'slot-scope')
    } else if ((slotScope = getAndRemoveAttr(el, 'slot-scope'))) {
      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' && el.attrsMap['v-for']) {
        warn(
          `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
          `(v-for takes higher priority). Use a wrapper <template> for the ` +
          `scoped slot to make it clearer.`,
          true
        )
      }
      el.slotScope = slotScope
    }
    // 常规插槽 slot
    const slotTarget = getBindingAttr(el, 'slot')
    if (slotTarget) {
      el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget
      // preserve slot as an attribute for native shadow DOM compat
      // only for non-scoped slots.
      // 若是一般插槽（非作用域插槽），将要分发到的 slot 的名称保存在元素的 slot 特性里
      if (el.tag !== 'template' && !el.slotScope) {
        addAttr(el, 'slot', slotTarget)
      }
    }
  }
}


/**
 * 处理组件标签里的 动态组件 和 内联模板
 */
function processComponent (el) {
  let binding
  if ((binding = getBindingAttr(el, 'is'))) {
    el.component = binding
  }
  if (getAndRemoveAttr(el, 'inline-template') != null) {
    el.inlineTemplate = true
  }
}

/**
 * 处理 attributes，包括指令和非指令
 */
function processAttrs (el) {
  const list = el.attrsList
  let i, l, name, rawName, value, modifiers, isProp
  for (i = 0, l = list.length; i < l; i++) {
    name = rawName = list[i].name
    value = list[i].value
    // const dirRE = /^v-|^@|^:/
    if (dirRE.test(name)) {
      // 处理指令

      // mark element as dynamic
      // 标记元素是动态的，在优化 AST 阶段，若 el.hasBindings 为 true，则该元素就不是静态节点
      el.hasBindings = true
      // modifiers
      // 处理修饰符
      modifiers = parseModifiers(name)
      // 移除修饰符
      // modifierRE = /\.[^.]+/g
      if (modifiers) {
        name = name.replace(modifierRE, '')
      }
      if (bindRE.test(name)) { // v-bind
        // 处理数据绑定 v-bind 指令
        // bindRE = /^:|^v-bind:/
        name = name.replace(bindRE, '')
        // 处理过滤器，返回最终的 value
        value = parseFilters(value)
        isProp = false
        if (modifiers) {
          if (modifiers.prop) {
            isProp = true
            name = camelize(name)
            if (name === 'innerHtml') name = 'innerHTML'
          }
          if (modifiers.camel) {
            name = camelize(name)
          }
          if (modifiers.sync) {
            // 将数据的双向绑定改为单项数据流 + 显示地传递事件给父组件修改数据的形式
            addHandler(
              el,
              `update:${camelize(name)}`,
              genAssignmentCode(value, `$event`)
            )
          }
        }
        if (isProp || (
          !el.component && platformMustUseProp(el.tag, el.attrsMap.type, name)
        )) {
          // 特性必须使用 property 来做数据绑定
          addProp(el, name, value)
        } else {
          addAttr(el, name, value)
        }
      } else if (onRE.test(name)) { // v-on
        // 处理事件监听
        // onRE = /^@|^v-on:/
        name = name.replace(onRE, '')
        addHandler(el, name, value, modifiers, false, warn)
      } else { // normal directives
        // 处理常规指令
        // dirRE = /^v-|^@|^:/
        name = name.replace(dirRE, '')
        // parse arg
        // argRE = /:(.*)$/
        // 解析指令的参数
        const argMatch = name.match(argRE)
        const arg = argMatch && argMatch[1]
        if (arg) {
          name = name.slice(0, -(arg.length + 1))
        }
        addDirective(el, name, rawName, value, arg, modifiers)
        if (process.env.NODE_ENV !== 'production' && name === 'model') {
          checkForAliasModel(el, value)
        }
      }
    } else {
      // literal attribute
      // 非指令特性
      if (process.env.NODE_ENV !== 'production') {
        const res = parseText(value, delimiters)
        if (res) {
          warn(
            `${name}="${value}": ` +
            'Interpolation inside attributes has been removed. ' +
            'Use v-bind or the colon shorthand instead. For example, ' +
            'instead of <div id="{{ val }}">, use <div :id="val">.'
          )
        }
      }
      addAttr(el, name, JSON.stringify(value))
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation
      if (!el.component &&
          name === 'muted' &&
          platformMustUseProp(el.tag, el.attrsMap.type, name)) {
        addProp(el, name, 'true')
      }
    }
  }
}

/**
 * 检查元素是否在 v-for 里
 */
function checkInFor (el: ASTElement): boolean {
  let parent = el
  while (parent) {
    if (parent.for !== undefined) {
      return true
    }
    parent = parent.parent
  }
  return false
}

/**
 * 解析指令上的修饰符，比如 v-click.prevent，返回修饰符对象，比如：
 *
 * {
 *   prevent: true
 * }
 */
function parseModifiers (name: string): Object | void {
  // modifierRE = /\.[^.]+/g
  const match = name.match(modifierRE)
  if (match) {
    const ret = {}
    match.forEach(m => { ret[m.slice(1)] = true })
    return ret
  }
}

/**
 * 将特性对象数组转变成特性 hash map
 *
 * 输入：[
 *   { name: attr1, value: value1 },
 *   { name: attr2, value: value2 }
 * ]
 *
 * 输出：{
 *   attr1: value1,
 *   attr2: value2
 * }
 */
function makeAttrsMap (attrs: Array<Object>): Object {
  const map = {}
  for (let i = 0, l = attrs.length; i < l; i++) {
    if (
      process.env.NODE_ENV !== 'production' &&
      map[attrs[i].name] && !isIE && !isEdge
    ) {
      warn('duplicate attribute: ' + attrs[i].name)
    }
    map[attrs[i].name] = attrs[i].value
  }
  return map
}

// for script (e.g. type="x/template") or style, do not decode content
function isTextTag (el): boolean {
  return el.tag === 'script' || el.tag === 'style'
}

/**
 * 模板内不能存在 style 和 script 标签
 */
function isForbiddenTag (el): boolean {
  return (
    el.tag === 'style' ||
    (el.tag === 'script' && (
      !el.attrsMap.type ||
      el.attrsMap.type === 'text/javascript'
    ))
  )
}

const ieNSBug = /^xmlns:NS\d+/
const ieNSPrefix = /^NS\d+:/

/* istanbul ignore next */
function guardIESVGBug (attrs) {
  const res = []
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    if (!ieNSBug.test(attr.name)) {
      attr.name = attr.name.replace(ieNSPrefix, '')
      res.push(attr)
    }
  }
  return res
}

/**
 * 检查 v-for 和 v-model 一起使用，且 v-model 的值为 v-for 的 alias
 */
function checkForAliasModel (el, value) {
  let _el = el
  while (_el) {
    if (_el.for && _el.alias === value) {
      warn(
        `<${el.tag} v-model="${value}">: ` +
        `You are binding v-model directly to a v-for iteration alias. ` +
        `This will not be able to modify the v-for source array because ` +
        `writing to the alias is like modifying a function local variable. ` +
        `Consider using an array of objects and use v-model on an object property instead.`
      )
    }
    _el = _el.parent
  }
}
