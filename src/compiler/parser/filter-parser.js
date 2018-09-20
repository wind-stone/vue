/* @flow */

const validDivisionCharRE = /[\w).+\-_$\]]/


/**
 * 解析过滤器
 * @param {*} exp 过滤器字符串，类似于：message | filterA | filterB | filterC('arg1', 'arg2')
 * @return _f("filterC")(_f("filterB")(_f("filterA")(message)), 'arg1', 'arg2')
 *
 * 其过程是：
 * 1. _f("filterA")(message)
 * 2. _f("filterB")(_f("filterA")(message))
 * 3. _f("filterC")(_f("filterB")(_f("filterA")(message)), 'arg1', 'arg2')
 */
export function parseFilters (exp: string): string {
  // 是否在单引号、双引号、模板字符串符号、正则表达式符号内
  let inSingle = false
  let inDouble = false
  let inTemplateString = false
  let inRegex = false
  // 判断是否在小括号、中括号、大括号内，计数为 0 代表括号闭合
  let curly = 0
  let square = 0
  let paren = 0
  // 上一个过滤式的开始索引
  let lastFilterIndex = 0
  // c: 当前字符
  // pre：上一个字符
  // expression：表达式
  // filters：过滤器数组
  let c, prev, i, expression, filters

  for (i = 0; i < exp.length; i++) {
    // ；
    prev = c
    c = exp.charCodeAt(i)
    // 0x5C: \
    if (inSingle) {
      // 0x27: '
      // 若当前已经在单引号 ' 内（即前面已经存在奇数个单引号 ' ）&& 当前字符是单引号 ' 并且没经过 \ 转义，则说明单引号已经闭合
      if (c === 0x27 && prev !== 0x5C) inSingle = false
    } else if (inDouble) {
      // 0x22: 双引号 "
      // 若当前已经在双引号 " 内（即前面已经存在奇数个双引号 " ）&& 当前字符是双引号 " 并且没经过 \ 转义，则说明双引号已经闭合
      if (c === 0x22 && prev !== 0x5C) inDouble = false
    } else if (inTemplateString) {
      // 0x60: `
      // 若当前已经在 ` 内（即前面已经存在奇数个 `）&& 当前字符是 `并且没经过 \ 转义，则说明模板字符串符号已经闭合
      if (c === 0x60 && prev !== 0x5C) inTemplateString = false
    } else if (inRegex) {
      // 0x2f: /
      // 若当前已经在 / 内（即前面已经存在奇数个 /）&& 当前字符是 /并且没经过 \ 转义，则说明正则表达式已经闭合
      if (c === 0x2f && prev !== 0x5C) inRegex = false
    } else if (
      // 0x7C: |
      // 是“管道”符号（即 | 符号） && 前后都不能是“管道”符号（即不能是 ||） && 不能在 {}、[]、() 之中
      c === 0x7C && // pipe
      exp.charCodeAt(i + 1) !== 0x7C &&
      exp.charCodeAt(i - 1) !== 0x7C &&
      !curly && !square && !paren
    ) {
      if (expression === undefined) {
        // first filter, end of expression
        // 第一个管道符的前面是表达式
        lastFilterIndex = i + 1
        expression = exp.slice(0, i).trim()
      } else {
        // 管道符后面的都是过滤器
        pushFilter()
      }
    } else {
      switch (c) {
        // 判断是否在单引号、双引号、模板字符串符号内
        case 0x22: inDouble = true; break         // "
        case 0x27: inSingle = true; break         // '
        case 0x60: inTemplateString = true; break // `
        // 判断是否在小括号、中括号、大括号内，计数为 0 代表括号闭合
        case 0x28: paren++; break                 // (
        case 0x29: paren--; break                 // )
        case 0x5B: square++; break                // [
        case 0x5D: square--; break                // ]
        case 0x7B: curly++; break                 // {
        case 0x7D: curly--; break                 // }
      }
      // 判断是否在正则表达式内
      if (c === 0x2f) { // /
        let j = i - 1
        let p
        // find first non-whitespace prev char
        for (; j >= 0; j--) {
          p = exp.charAt(j)
          if (p !== ' ') break
        }
        if (!p || !validDivisionCharRE.test(p)) {
          inRegex = true
        }
      }
    }
  }

  if (expression === undefined) {
    // 若没匹配到表达式，说明没有管道符号，则整个 exp 都是表达式
    expression = exp.slice(0, i).trim()
  } else if (lastFilterIndex !== 0) {
    // 最后一个过滤器
    pushFilter()
  }

  /**
   * 将过滤器添加到过滤器数组里
   */
  function pushFilter () {
    // 上一个管道符号到当前管道符号之间的是过滤器
    (filters || (filters = [])).push(exp.slice(lastFilterIndex, i).trim())
    lastFilterIndex = i + 1
  }

  if (filters) {
    for (i = 0; i < filters.length; i++) {
      expression = wrapFilter(expression, filters[i])
    }
  }

  return expression
}

/**
 * 包装过滤器
 */
function wrapFilter (exp: string, filter: string): string {
  const i = filter.indexOf('(')
  if (i < 0) {
    // _f: resolveFilter
    return `_f("${filter}")(${exp})`
  } else {
    const name = filter.slice(0, i)
    const args = filter.slice(i + 1)
    return `_f("${name}")(${exp}${args !== ')' ? ',' + args : args}`
  }
}
