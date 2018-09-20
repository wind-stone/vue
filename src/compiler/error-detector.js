/* @flow */

import { dirRE, onRE } from './parser/index'

// these keywords should not appear inside expressions, but operators like
// typeof, instanceof and in are allowed
// 以下这些单词不能出现在模板内的表达式里，但是像 typeof、instanceof、in 这样的操作符可以
// \b 元字符匹配单词边界，比如/oo\b/ 不匹配 "moon" 中的 'oo'，但匹配 "moo" 中的 'oo'
const prohibitedKeywordRE = new RegExp('\\b' + (
  'do,if,for,let,new,try,var,case,else,with,await,break,catch,class,const,' +
  'super,throw,while,yield,delete,export,import,return,switch,default,' +
  'extends,finally,continue,debugger,function,arguments'
).split(',').join('\\b|\\b') + '\\b')

// these unary operators should not be used as property/method names
// 一元操作符不能作为属性/方法的名称
const unaryOperatorsRE = new RegExp('\\b' + (
  'delete,typeof,void'
).split(',').join('\\s*\\([^\\)]*\\)|\\b') + '\\s*\\([^\\)]*\\)')

// strip strings in expressions
/**
 * 剥离字符串左右两边的引号，这个引号包括单引号、双引号、模板字符串符号
 * 拆解正则
 * /
 *  1. 单引号包裹的，任意个如下类型的字符，其中“\.”代表一个转义字符，比如“\n”。可以匹配：'ab\n'
 *    1.1 “非单引号非反斜杠”字符
 *    1.2 “\.”
 *  '(?:[^'\\]|\\.)*'|
 *  2. 单引号包裹的，任意个如下类型的字符，其中“\.”代表一个转义字符，比如“\n”。可以匹配："ab\n"
 *    2.1 “非双引号非反斜杠”字符
 *    2.2 “\.”
 *  "(?:[^"\\]|\\.)*"|
 *  3. 单个模板字符串，右边是任意个“非模板字符串符号非反斜杠”字符，再右边是“${”，比如匹配：`one${
 *  `(?:[^`\\]|\\.)*\$\{|
 *  4. "}"，右边是任意个“非模板字符串符号非反斜杠”字符，比如匹配 }another`。
 *  \}(?:[^`\\]|\\.)*`|
 *  5. 模板字符串包裹的，任意个如下类型的字符，其中“\.”代表一个转义字符，比如“\n”。可以匹配：`ab\n`
 *    5.1 “非模板字符串符号非反斜杠”字符
 *    5.2 “\.”
 *  `(?:[^`\\]|\\.)*`
 * /
 *
 * PS：上面的第 3. 和 4. 两点，正好会剥离模板字符串的字符串部分，把标识符留下来了，比如，
 *
 * const str = `one${Identifier}another`
 * str = str.replace(stripStringRE, '')
 * console.log(str)  // 结果是 Identifier
 */
const stripStringRE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*\$\{|\}(?:[^`\\]|\\.)*`|`(?:[^`\\]|\\.)*`/g

// detect problematic expressions in a template
export function detectErrors (ast: ?ASTNode): Array<string> {
  const errors: Array<string> = []
  if (ast) {
    checkNode(ast, errors)
  }
  return errors
}

function checkNode (node: ASTNode, errors: Array<string>) {
  if (node.type === 1) {
    for (const name in node.attrsMap) {
      // 检查指令
      // dirRE = /^v-|^@|^:/
      if (dirRE.test(name)) {
        const value = node.attrsMap[name]
        if (value) {
          if (name === 'v-for') {
            checkFor(node, `v-for="${value}"`, errors)
          } else if (onRE.test(name)) {
            // onRE = /^@|^v-on:/
            checkEvent(value, `${name}="${value}"`, errors)
          } else {
            checkExpression(value, `${name}="${value}"`, errors)
          }
        }
      }
    }
    // 递归地检查子节点
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        checkNode(node.children[i], errors)
      }
    }
  } else if (node.type === 2) {
    // 带插值的文本节点
    checkExpression(node.expression, node.text, errors)
  }
}

/**
 * 检查事件的表达里是否使用了一元操作符作为了属性名称，以及 checkExpression
 */
function checkEvent (exp: string, text: string, errors: Array<string>) {
  const stipped = exp.replace(stripStringRE, '')
  const keywordMatch: any = stipped.match(unaryOperatorsRE)
  // 避免在事件的表达式里使用一元操作符，比如 <ul @click="delete">、<ul @click="`${delete}`">
  if (keywordMatch && stipped.charAt(keywordMatch.index - 1) !== '$') {
    errors.push(
      `avoid using JavaScript unary operator as property name: ` +
      `"${keywordMatch[0]}" in expression ${text.trim()}`
    )
  }
  checkExpression(exp, text, errors)
}

function checkFor (node: ASTElement, text: string, errors: Array<string>) {
  checkExpression(node.for || '', text, errors)
  checkIdentifier(node.alias, 'v-for alias', text, errors)
  checkIdentifier(node.iterator1, 'v-for iterator', text, errors)
  checkIdentifier(node.iterator2, 'v-for iterator', text, errors)
}

/**
 * 检查所给的字符串是否能作为标识符
 */
function checkIdentifier (
  ident: ?string,
  type: string,
  text: string,
  errors: Array<string>
) {
  if (typeof ident === 'string') {
    try {
      new Function(`var ${ident}=_`)
    } catch (e) {
      errors.push(`invalid ${type} "${ident}" in expression: ${text.trim()}`)
    }
  }
}

/**
 * 检查表达式是否存在问题，以下两种情况不允许
 *
 * 1. 剥离字符串部分的表达式里，包含的属性是关键字
 * 2. 表达式无效
 */
function checkExpression (exp: string, text: string, errors: Array<string>) {
  try {
    new Function(`return ${exp}`)
  } catch (e) {
    // 禁止在表达式里出现 关键字
    const keywordMatch = exp.replace(stripStringRE, '').match(prohibitedKeywordRE)
    if (keywordMatch) {
      errors.push(
        `avoid using JavaScript keyword as property name: ` +
        `"${keywordMatch[0]}"\n  Raw expression: ${text.trim()}`
      )
    } else {
      errors.push(
        `invalid expression: ${e.message} in\n\n` +
        `    ${exp}\n\n` +
        `  Raw expression: ${text.trim()}\n`
      )
    }
  }
}
