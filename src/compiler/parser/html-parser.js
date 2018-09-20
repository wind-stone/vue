/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson, Mozilla Public License
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

function makeMap (
  str,
  expectsLowerCase
) {
  const map = Object.create(null)
  const list = str.split(',')
  for (let i = 0; i < list.length; i++) {
    map[list[i]] = true
  }
  return expectsLowerCase
    ? val => map[val.toLowerCase()]
    : val => map[val]
}

const no = () => false

const isNonPhrasingTag = makeMap(
  'address,article,aside,base,blockquote,body,caption,col,colgroup,dd,' +
  'details,dialog,div,dl,dt,fieldset,figcaption,figure,footer,form,' +
  'h1,h2,h3,h4,h5,h6,head,header,hgroup,hr,html,legend,li,menuitem,meta,' +
  'optgroup,option,param,rp,rt,source,style,summary,tbody,td,tfoot,th,thead,' +
  'title,tr,track'
)

// Regular Expressions for parsing tags and attributes
/**
 * attribute 正则分析
 *
 * /
 * ^\s*([^\s"'<>\/=]+)  特性的名称
 *  (?:
 *    \s*
 *    (=)  特性的等号
 *    \s*
 *    (?:
 *      "([^"]*)"+|     用双引号""包含起来的特性值
 *      '([^']*)'+|     用单引号''包含起来的特性值
 *      ([^\s"'=<>`]+)  不用单双引号包含起来的特性值
 *    )
 *  )?
 * /
 *
 */
const attribute = /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
// could use https://www.w3.org/TR/1999/REC-xml-names-19990114/#NT-QName
// but for Vue templates we can enforce a simple charset
const ncname = '[a-zA-Z_][\\w\\-\\.]*'
const qnameCapture = `((?:${ncname}\\:)?${ncname})`
const startTagOpen = new RegExp(`^<${qnameCapture}`)
const startTagClose = /^\s*(\/?)>/
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`)
const doctype = /^<!DOCTYPE [^>]+>/i
// #7298: escape - to avoid being pased as HTML comment when inlined in page
const comment = /^<!\--/
const conditionalComment = /^<!\[/

let IS_REGEX_CAPTURING_BROKEN = false
'x'.replace(/x(.)?/g, function (m, g) {
  IS_REGEX_CAPTURING_BROKEN = g === ''
})

// Special Elements (can contain anything)
const isPlainTextElement = makeMap('script,style,textarea', true)
const reCache = {}

const decodingMap = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&#10;': '\n',
  '&#9;': '\t'
}
const encodedAttr = /&(?:lt|gt|quot|amp);/g
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#10|#9);/g

// #5992
const isIgnoreNewlineTag = makeMap('pre,textarea', true)
const shouldIgnoreFirstNewline = (tag, html) => tag && isIgnoreNewlineTag(tag) && html[0] === '\n'

/**
 * 解码特性的值里的编码的字符
 * @param {*} value 特性的值
 * @param {*} shouldDecodeNewlines 是否需要解码
 *
 * TODO: 这是为了防止 XSS 攻击吗？
 */
function decodeAttr (value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr
  return value.replace(re, match => decodingMap[match])
}

/**
 * 解析 html 模板
 * @param {String} html 模板字符串
 * @param {Object} options 选项对象
 */
function parseHTML (html, options) {
  const stack = []
  const expectHTML = options.expectHTML
  const isUnaryTag = options.isUnaryTag || no
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no
  let index = 0
  // lastTag 是上一个已经处理完开始标签，但是还没处理结束标签的元素
  let last, lastTag
  while (html) {
    last = html
    // Make sure we're not in a plaintext content element like script/style
    if (!lastTag || !isPlainTextElement(lastTag)) {
      let textEnd = html.indexOf('<')
      // 匹配注释、IE条件注释、doctype、开始标签、结束标签
      if (textEnd === 0) {
        // Comment:
        // html 以 正常注释文本 开头：去掉注释继续下一次循环
        // comment = /^<!\--/
        if (comment.test(html)) {
          const commentEnd = html.indexOf('-->')

          if (commentEnd >= 0) {
            if (options.shouldKeepComment) {
              // 处理 注释内容
              options.comment(html.substring(4, commentEnd))
            }
            advance(commentEnd + 3)
            continue
          }
        }

        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        // html 以 IE条件注释文本 开头：去掉注释继续下一次循环
        // conditionalComment = /^<!\[/
        if (conditionalComment.test(html)) {
          const conditionalEnd = html.indexOf(']>')

          if (conditionalEnd >= 0) {
            advance(conditionalEnd + 2)
            continue
          }
        }

        // Doctype:
        // html 以 Doctype 开头：去掉 Doctype 继续下一次循环
        // doctype = /^<!DOCTYPE [^>]+>/i
        const doctypeMatch = html.match(doctype)
        if (doctypeMatch) {
          advance(doctypeMatch[0].length)
          continue
        }

        // End tag:
        // html 以结束标签开头：去掉结束标签继续下一次循环，并处理结束标签
        const endTagMatch = html.match(endTag)
        // ncname = '[a-zA-Z_][\\w\\-\\.]*'
        // qnameCapture = `((?:${ncname}\\:)?${ncname})`
        // endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`)
        if (endTagMatch) {
          const curIndex = index
          advance(endTagMatch[0].length)
          parseEndTag(endTagMatch[1], curIndex, index)
          continue
        }

        // Start tag:
        // html 以开始标签开头：
        const startTagMatch = parseStartTag()
        if (startTagMatch) {
          handleStartTag(startTagMatch)
          if (shouldIgnoreFirstNewline(lastTag, html)) {
            // pre、textarea 标签内，忽略首个 \n
            advance(1)
          }
          continue
        }
      }

      // 若是不能匹配，则获取文本
      let text, rest, next
      if (textEnd >= 0) {
        rest = html.slice(textEnd)

        // 查找到第一个能解析出来的 <，从 0 ~ 这个能解析出来的 < 字符之间的内容都是文本（有可能找不到能解析的 <）
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          // 若 html 里只有一个 <
          next = rest.indexOf('<', 1)
          if (next < 0) break

          // 若 html 里有至少两个 <
          textEnd += next
          rest = html.slice(textEnd)
        }
        // while 循环结束时，textEnd 为 html 里最后一个不能解析为 结束标签/开始标签的前部/注释标签/条件注释标签 的 < 的位置
        // 即 textEnd 之前的部分都将成为文本
        text = html.substring(0, textEnd)
        advance(textEnd)
      }

      // 若 html 里没有 <，则整个 html 都为文本
      if (textEnd < 0) {
        text = html
        html = ''
      }

      // 调用 options.chars 处理文本内容
      if (options.chars && text) {
        options.chars(text)
      }
    } else {
      // lastTag 是 script,style,textarea 时，会走到这里
      // 即，接下来处理 script,style,textarea 内的内容（包括闭合标签）
      let endTagLength = 0
      const stackedTag = lastTag.toLowerCase()
      const reStackedTag = reCache[stackedTag] || (reCache[stackedTag] = new RegExp('([\\s\\S]*?)(</' + stackedTag + '[^>]*>)', 'i'))
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length
        if (!isPlainTextElement(stackedTag) && stackedTag !== 'noscript') {
          text = text
            // <![CDATA[这里是不被 HTML 解析的内容]]>
            // <!\--这里是不被 HTML 解析的内容-->
            // 上面两种情况里包含的内容不会被 HMLT 解析，其中可能会包含 js 代码，因此需要将 <!\-- -->、<![CDATA[]]> 移除
            .replace(/<!\--([\s\S]*?)-->/g, '$1') // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
        }
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          // pre、textarea 标签内，忽略首个 \n
          text = text.slice(1)
        }
        if (options.chars) {
          options.chars(text)
        }
        return ''
      })
      index += html.length - rest.length
      html = rest
      // 解析结束标签
      parseEndTag(stackedTag, index - endTagLength, index)
    }

    if (html === last) {
      // 若该轮循环 html 没有发生如何变化（即没有解析出任何内容），发出警告
      options.chars && options.chars(html)
      if (process.env.NODE_ENV !== 'production' && !stack.length && options.warn) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`)
      }
      break
    }
  }

  // Clean up any remaining tags
  parseEndTag()

  /**
   * 截取 html 模板，并设置当前 html 模板的开始位置位于最初 html 模板里的位置
   */
  function advance (n) {
    index += n
    // 保留 n ~ html.length 的字符串
    html = html.substring(n)
  }

  /**
   * 解析开始标签，返回结果对象
   * {
   *   tagName, 标签名
   *   attrs, 特性匹配数组
   *   start, 开始标签在 template 里的开始位置
   *   end, （可选）开始标签在 template 里的结束位置
   *   unarySlash, 一元标签的 /
   * }
   */
  function parseStartTag () {
    // ncname = '[a-zA-Z_][\\w\\-\\.]*'
    // qnameCapture = `((?:${ncname}\\:)?${ncname})`
    // startTagOpen = new RegExp(`^<${qnameCapture}`)
    const start = html.match(startTagOpen)
    if (start) {
      const match = {
        tagName: start[1],
        // 保存特性匹配结果数组，其元素是个 Array.prototype.match() 的匹配结果数组
        attrs: [],
        start: index
      }
      advance(start[0].length)
      let end, attr
      // 没匹配到开始标签的关闭 && 匹配到特性
      // startTagClose = /^\s*(\/?)>/
      while (!(end = html.match(startTagClose)) && (attr = html.match(attribute))) {
        advance(attr[0].length)
        match.attrs.push(attr)
      }
      if (end) {
        // 一元标签的 slash
        match.unarySlash = end[1]
        advance(end[0].length)
        match.end = index
        return match
      }
    }
  }

  /**
   * 处理开始标签
   * @param {Object} match 开始标签的正则匹配结果
   *   {String} tagName 标签名
   *   {Array} attrs 特性数组，其元素为特性的 Array.prototype.match 的匹配结果数组
   *   {Number} start 开始标签的位置
   *   {Number} end 可选，开始标签的位置（> 的下一位置）
   *   {String} unarySlash 可选，一元开始标签的 /
   *
   * 所做的处理有：
   * 1. 某些情况下，需要先结束上一标签
   * 2. 将特性处理成对象形式，如 attrs = [{ name, value }, ...]
   * 3. 对于非一元标签，将其推入 stack 栈中，更新 lastTag
   * 4. 调用 options.start 函数，创建 AST 元素，处理指令、事件、特性等等
   */
  function handleStartTag (match) {
    const tagName = match.tagName
    const unarySlash = match.unarySlash

    // 某些情况下，先结束上一标签
    if (expectHTML) {
      if (lastTag === 'p' && isNonPhrasingTag(tagName)) {
        // 对于不能出现在 p 标签内的元素
        // 先结束解析上一个 p 标签
        parseEndTag(lastTag)
      }
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        // 当前标签是可以不关闭的，且上一个元素是同一标签，比如  <li> 111 <li> 222
        // 则先将上一标签关闭
        parseEndTag(tagName)
      }
    }

    const unary = isUnaryTag(tagName) || !!unarySlash

    const l = match.attrs.length
    const attrs = new Array(l)
    /**
     * attribute 正则分析
     *
     * /
     * ^\s*([^\s"'<>\/=]+)  特性的名称
     *  (?:
     *    \s*
     *    (=)  特性的等号
     *    \s*
     *    (?:
     *      "([^"]*)"+|     用双引号""包含起来的特性值    args[3]
     *      '([^']*)'+|     用单引号''包含起来的特性值    args[4]
     *      ([^\s"'=<>`]+)  不用单双引号包含起来的特性值   args[5]
     *    )
     *  )?
     * /
     *
     */
    // 将特性处理成对象形式，{ name, value }
    for (let i = 0; i < l; i++) {
      const args = match.attrs[i]
      // hackish work around FF bug https://bugzilla.mozilla.org/show_bug.cgi?id=369778
      if (IS_REGEX_CAPTURING_BROKEN && args[0].indexOf('""') === -1) {
        if (args[3] === '') { delete args[3] }
        if (args[4] === '') { delete args[4] }
        if (args[5] === '') { delete args[5] }
      }
      // 特性的值
      const value = args[3] || args[4] || args[5] || ''
      const shouldDecodeNewlines = tagName === 'a' && args[1] === 'href'
        ? options.shouldDecodeNewlinesForHref
        : options.shouldDecodeNewlines
      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines)
      }
    }

    // 非一元标签，推入栈中（等待结束标签），更新 lastTag
    if (!unary) {
      stack.push({ tag: tagName, lowerCasedTag: tagName.toLowerCase(), attrs: attrs })
      lastTag = tagName
    }

    // 处理开始标签：创建 AST 元素，处理指令、事件、特性等等
    if (options.start) {
      options.start(tagName, attrs, unary, match.start, match.end)
      console.log('开始标签数据：', tagName, attrs, unary, match.start, match.end)
    }
  }

  /**
   * 解析结束标签：若堆栈里有没闭合的标签，发出警告；针对 br 和 p 标签做一些异常处理
   * @param {*} tagName 结束标签名
   * @param {*} start 结束标签的开始位置（即 </xxx> 的 < 的位置）
   * @param {*} end 结束标签的结束位置（即 </xxx> 的 > 的下一位置）
   */
  function parseEndTag (tagName, start, end) {
    let pos, lowerCasedTagName
    if (start == null) start = index
    if (end == null) end = index

    if (tagName) {
      lowerCasedTagName = tagName.toLowerCase()
    }

    // Find the closest opened tag of the same type
    // 查找 stack 栈里最后进栈的相同标签，若找不到相同标签，pos 为 -1
    if (tagName) {
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break
        }
      }
    } else {
      // If no tag name is provided, clean shop
      pos = 0
    }

    if (pos >= 0) {
      // Close all the open elements, up the stack
      // 对于没闭合的标签，发出警告，并调用 options.end 闭合
      for (let i = stack.length - 1; i >= pos; i--) {
        if (process.env.NODE_ENV !== 'production' &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          options.warn(
            `tag <${stack[i].tag}> has no matching end tag.`
          )
        }
        if (options.end) {
          options.end(stack[i].tag, start, end)
        }
      }

      // Remove the open elements from the stack
      stack.length = pos

      // 标签闭合后，更新 lastTag
      lastTag = pos && stack[pos - 1].tag
    } else if (lowerCasedTagName === 'br') {
      // 没找到对应的开始标签 && </br>：将 </br> 转换成 <br>
      // PS: <br></br> 这种使用是错误的，经过此处的处理，将变成 <br><br>
      if (options.start) {
        options.start(tagName, [], true, start, end)
      }
    } else if (lowerCasedTagName === 'p') {
      // 没找到对应的开始标签 && </p>：添加开始标签
      if (options.start) {
        options.start(tagName, [], false, start, end)
      }
      if (options.end) {
        options.end(tagName, start, end)
      }
    }
  }
}

const template =
`<div class="container">
  <!--这里是注释内容-->
  <p v-if="isRoot" style="font-size: 12px">插值内容<br>{{ chazhi }}</p>
</div>`

parseHTML(template.trim(), {
  start(tag, attrs, unary) {
  },
  end() {
    console.log('哈哈')
  },
  chars(text) {
    console.log(text.replace(/\s/g, '*'))
  },
  comment(text) {
    console.log(text)
  },
  shouldKeepComment: true
})
