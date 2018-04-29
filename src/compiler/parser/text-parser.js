/* @flow */

/**
 * 该文件主要处理文本里插值，返回去除插值之后的表达式
 */

import { cached } from 'shared/util'
import { parseFilters } from './filter-parser'

const defaultTagRE = /\{\{((?:.|\n)+?)\}\}/g

/**
 * 正则表达式分析
 *
 * /[
 *    -.*+?^${}()|[\]\/\\
 * ]/
 *
 * 该正则表达式匹配单个字符，这些字符是：
 * -
 * .
 * *
 * +
 * ?
 * ^
 * $
 * {
 * }
 * (
 * )
 * |
 * [
 * ]
 * /
 * \
 */
const regexEscapeRE = /[-.*+?^${}()|[\]\/\\]/g

/**
 * 将自定义的分隔符拼装成正则表达式
 */
const buildRegex = cached(delimiters => {
  // $& 代表为匹配到的子字符串
  const open = delimiters[0].replace(regexEscapeRE, '\\$&')
  const close = delimiters[1].replace(regexEscapeRE, '\\$&')
  return new RegExp(open + '((?:.|\\n)+?)' + close, 'g')
})

type TextParseResult = {
  expression: string,
  tokens: Array<string | { '@binding': string }>
}

/**
 * 处理文本的插值部分
 */
export function parseText (
  text: string,
  delimiters?: [string, string]
): TextParseResult | void {
  const tagRE = delimiters ? buildRegex(delimiters) : defaultTagRE
  if (!tagRE.test(text)) {
    return
  }
  const tokens = []
  const rawTokens = []
  let lastIndex = tagRE.lastIndex = 0
  let match, index, tokenValue
  while ((match = tagRE.exec(text))) {
    index = match.index
    // push text token
    if (index > lastIndex) {
      // 两个插值表达式之间的部分 或 第一个插值表达式的左边部分
      rawTokens.push(tokenValue = text.slice(lastIndex, index))
      tokens.push(JSON.stringify(tokenValue))
    }
    // tag token
    const exp = parseFilters(match[1].trim())
    tokens.push(`_s(${exp})`)
    rawTokens.push({ '@binding': exp })
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) {
    // 文本里不包含插值的最后部分
    rawTokens.push(tokenValue = text.slice(lastIndex))
    tokens.push(JSON.stringify(tokenValue))
  }
  return {
    expression: tokens.join('+'),
    tokens: rawTokens
  }
}
