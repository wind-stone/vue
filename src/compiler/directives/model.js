/* @flow */

/**
 * Cross-platform code generation for component v-model
 * 跨平台生成组件节点 v-model 指令的代码
 *
 * @param {*} el 组件 AST 节点
 * @param {*} value v-model 的表达式
 * @param {*} modifiers v-model 的修饰符对象
 */
export function genComponentModel (
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
): ?boolean {
  const { number, trim } = modifiers || {}

  const baseValueExpression = '$$v'
  let valueExpression = baseValueExpression
  if (trim) {
    valueExpression =
      `(typeof ${baseValueExpression} === 'string'` +
      `? ${baseValueExpression}.trim()` +
      `: ${baseValueExpression})`
  }
  if (number) {
    // _n: toNumber，转换为数字
    valueExpression = `_n(${valueExpression})`
  }
  const assignment = genAssignmentCode(value, valueExpression)

  el.model = {
    value: `(${value})`,
    expression: `"${value}"`,
    callback: `function (${baseValueExpression}) {${assignment}}`
  }
}

/**
 * Cross-platform codegen helper for generating v-model value assignment code.
 */
export function genAssignmentCode (
  value: string,
  assignment: string
): string {
  const res = parseModel(value)
  if (res.key === null) {
    return `${value}=${assignment}`
  } else {
    return `$set(${res.exp}, ${res.key}, ${assignment})`
  }
}

/**
 * Parse a v-model expression into a base path and a final key segment.
 * Handles both dot-path and possible square brackets.
 *
 * Possible cases:
 *
 * - test
 * - test[key]
 * - test[test1[key]]
 * - test["a"][key]
 * - xxx.test[a[a].test1[key]]
 * - test.xxx.a["asa"][test1[key]]
 *
 */

let len, str, chr, index, expressionPos, expressionEndPos

type ModelParseResult = {
  exp: string,
  key: string | null
}

/**
 * 解析出 v-model 表达式里的 exp 部分和 key 部分
 * @param {*} val 表达式
 * @return {Object} 结果对象，{ exp、key }
 *
 * 针对可能的表达式返回的结果：
 *
 * - test ：                              {exp: 'test', key: null}
 * - test.test1 :                         {exp: 'test', key: '"test1"'}
 * - test[key]                            {exp: 'test', key: 'key'}
 * - test[test1[key]]                     {exp: 'test', key: 'test1[key]'}
 * - test["a"][key]                       {exp: 'test["a"]', key: 'key'}
 * - xxx.test[a[a].test1[key]]            {exp: 'xxx.test', key: 'a[a].test1[key]'}
 * - test.xxx.a["asa"][test1[key]]        {exp: 'test.xxx.a["asa"]', key: 'test1[key]'}
 */
export function parseModel (val: string): ModelParseResult {
  // Fix https://github.com/vuejs/vue/pull/7730
  // allow v-model="obj.val " (trailing whitespace)
  val = val.trim()
  len = val.length

  // 不存在 [，或 ] 不是最后一位
  if (val.indexOf('[') < 0 || val.lastIndexOf(']') < len - 1) {
    index = val.lastIndexOf('.')
    if (index > -1) {
      return {
        exp: val.slice(0, index),
        key: '"' + val.slice(index + 1) + '"'
      }
    } else {
      return {
        exp: val,
        key: null
      }
    }
  }

  str = val
  index = expressionPos = expressionEndPos = 0

  while (!eof()) {
    chr = next()
    /* istanbul ignore if */
    if (isStringStart(chr)) {
      parseString(chr)
    } else if (chr === 0x5B) {
      // 0x5B: 左中括号 [
      parseBracket(chr)
    }
  }

  return {
    exp: val.slice(0, expressionPos),
    key: val.slice(expressionPos + 1, expressionEndPos)
  }
}

function next (): number {
  return str.charCodeAt(++index)
}

function eof (): boolean {
  return index >= len
}

function isStringStart (chr: number): boolean {
  // 0x22: 双引号 "
  // 0x27: 单引号 '
  return chr === 0x22 || chr === 0x27
}

function parseBracket (chr: number): void {
  let inBracket = 1
  expressionPos = index
  while (!eof()) {
    chr = next()
    if (isStringStart(chr)) {
      parseString(chr)
      continue
    }
    // 0x5B: 左中括号 [
    // 0x5D: 右中括号 ]
    if (chr === 0x5B) inBracket++
    if (chr === 0x5D) inBracket--
    if (inBracket === 0) {
      expressionEndPos = index
      break
    }
  }
}

/**
 * 解析字符串，找到下一个相同的符号，比如 " 或 '
 */
function parseString (chr: number): void {
  const stringQuote = chr
  while (!eof()) {
    chr = next()
    if (chr === stringQuote) {
      break
    }
  }
}
