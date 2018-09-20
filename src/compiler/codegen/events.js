/* @flow */

/**
 * 函数表达式
 * /
 *   ^(                 情况一：匹配箭头函数，param => { ... } 或 () => { ... }
 *     [\w$_]+|
 *     \([^)]*?\)
 *   )\s*=>|
 *   ^function\s*\(     情况二：匹配常规函数，function () { ... }
 * /
 */
const fnExpRE = /^([\w$_]+|\([^)]*?\))\s*=>|^function\s*\(/

/**
 * 组件方法的路径
 *
 * 可能有如下情况：
 * - 情况 1：方法，比如 abc
 * - 情况 2：对象方法，比如 abc.def
 * - 情况 3：对象方法，比如 abc['def']
 * - 情况 4：对象方法，比如 abc["def"]
 * - 情况 5：数组元素，比如 abc[2]
 * - 情况 6：对象方法，但是 key 为变量名，比如 abc[def]
 *
 * 其中，
 * 情况 1 里的 abc 方法可能来自于：
 *   - 组件选项对象 methods 选项里定义的方法
 *   - 组件选项对象 data 选项里定义的方法
 *   - 组件选项对象 props 选项里定义的方法，由父组件传入
 *   - 组件选项对象 computed 选项里定义的计算属性返回的方法
 *
 * 情况 2~6 里的对象 abc，可能来自于 data、props、computed 选项
 *
 * /^
 *   [A-Za-z_$][\w$]*         情况 1：变量名，以 [A-Za-z_$] 中任意一个单字字符开头，后面跟着任意个 \w 或 $，其中 \w 代表 [A-Za-z0-9_]
 *   (?:
 *     \.[A-Za-z_$][\w$]*|    情况 2
 *     \['[^']*?']|           情况 3
 *     \["[^"]*?"]|           情况 4
 *     \[\d+]|                情况 5
 *     \[[A-Za-z_$][\w$]*]    情况 6
 *   )*
 * $/
 */
const simplePathRE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\['[^']*?']|\["[^"]*?"]|\[\d+]|\[[A-Za-z_$][\w$]*])*$/

// KeyboardEvent.keyCode aliases
const keyCodes: { [key: string]: number | Array<number> } = {
  esc: 27,
  tab: 9,
  enter: 13,
  space: 32,
  up: 38,
  left: 37,
  right: 39,
  down: 40,
  'delete': [8, 46]
}

// KeyboardEvent.key aliases
const keyNames: { [key: string]: string | Array<string> } = {
  // #7880: IE11 and Edge use `Esc` for Escape key name.
  esc: ['Esc', 'Escape'],
  tab: 'Tab',
  enter: 'Enter',
  space: ' ',
  // #7806: IE11 uses key names without `Arrow` prefix for arrow keys.
  up: ['Up', 'ArrowUp'],
  left: ['Left', 'ArrowLeft'],
  right: ['Right', 'ArrowRight'],
  down: ['Down', 'ArrowDown'],
  'delete': ['Backspace', 'Delete']
}

// #4868: modifiers that prevent the execution of the listener
// need to explicitly return null so that we can determine whether to remove
// the listener for .once
const genGuard = condition => `if(${condition})return null;`

// 内置固定的修饰符及对应代码
const modifierCode: { [key: string]: string } = {
  stop: '$event.stopPropagation();',
  prevent: '$event.preventDefault();',
  self: genGuard(`$event.target !== $event.currentTarget`),
  ctrl: genGuard(`!$event.ctrlKey`),
  shift: genGuard(`!$event.shiftKey`),
  alt: genGuard(`!$event.altKey`),
  meta: genGuard(`!$event.metaKey`),
  left: genGuard(`'button' in $event && $event.button !== 0`),
  middle: genGuard(`'button' in $event && $event.button !== 1`),
  right: genGuard(`'button' in $event && $event.button !== 2`)
}

/**
 * 生成最终的 data.nativeOn/on 代码
 * @param {*} events el.nativeEvents/events
 * @param {*} isNative 是否是原生事件
 * @param {*} warn 警告函数
 */
export function genHandlers (
  events: ASTElementHandlers,
  isNative: boolean,
  warn: Function
): string {
  let res = isNative ? 'nativeOn:{' : 'on:{'
  for (const name in events) {
    res += `"${name}":${genHandler(name, events[name])},`
  }
  return res.slice(0, -1) + '}'
}

// Generate handler code with binding params on Weex
/* istanbul ignore next */
function genWeexHandler (params: Array<any>, handlerCode: string) {
  let innerHandlerCode = handlerCode
  const exps = params.filter(exp => simplePathRE.test(exp) && exp !== '$event')
  const bindings = exps.map(exp => ({ '@binding': exp }))
  const args = exps.map((exp, i) => {
    const key = `$_${i + 1}`
    innerHandlerCode = innerHandlerCode.replace(exp, key)
    return key
  })
  args.push('$event')
  return '{\n' +
    `handler:function(${args.join(',')}){${innerHandlerCode}},\n` +
    `params:${JSON.stringify(bindings)}\n` +
    '}'
}

/**
 * 生成最终的事件处理方法，可能是方法路径、函数表达式
 * @param {*} name 事件名称
 * @param {*} handler 事件处理器，可以是方法路径、函数表达式、内联 JavaScript 语句
 */
function genHandler (
  name: string,
  handler: ASTElementHandler | Array<ASTElementHandler>
): string {
  if (!handler) {
    return 'function(){}'
  }

  if (Array.isArray(handler)) {
    return `[${handler.map(handler => genHandler(name, handler)).join(',')}]`
  }

  // 指令的表达式是父组件（可能是嵌套）的方法路径
  const isMethodPath = simplePathRE.test(handler.value)
  // 指令的表达式是函数表达式（箭头函数或常规函数定义）
  const isFunctionExpression = fnExpRE.test(handler.value)

  if (!handler.modifiers) {
    // 没有修饰符
    // PS: 组件节点上的自定义事件是没有任何修饰符的
    if (isMethodPath || isFunctionExpression) {
      // 针对指令的表达式是方法路径和函数表达式，直接返回 value
      return handler.value
    }
    /* istanbul ignore if */
    if (__WEEX__ && handler.params) {
      return genWeexHandler(handler.params, handler.value)
    }
    // 针对指令的表达式是内联 JavaScript 语句，要封装成函数表达式
    // 比如  v-click="handleClick('hello', $event)"
    return `function($event){${handler.value}}` // inline statement
  } else {
    // 有修饰符
    let code = ''
    let genModifierCode = ''
    const keys = []
    for (const key in handler.modifiers) {
      if (modifierCode[key]) {
        // 生成特定的修饰符的代码
        genModifierCode += modifierCode[key]
        // left/right
        // left/right 修饰符，需要再进行另外的处理
        if (keyCodes[key]) {
          keys.push(key)
        }
      } else if (key === 'exact') {
        // exact 修饰符：https://cn.vuejs.org/v2/guide/events.html#exact-%E4%BF%AE%E9%A5%B0%E7%AC%A6
        // 有且只有指定的修饰符，事件才会触发
        const modifiers: ASTModifiers = (handler.modifiers: any)
        genModifierCode += genGuard(
          ['ctrl', 'shift', 'alt', 'meta']
            .filter(keyModifier => !modifiers[keyModifier])
            .map(keyModifier => `$event.${keyModifier}Key`)
            .join('||')
        )
      } else {
        // 不在内置的修饰符名单里，且不是 exact 修饰符，统统推入数组里
        keys.push(key)
      }
    }
    // 针对没匹配到内置固定的修饰符或 left/right 修饰符，判断是否满足条件
    // 若非数字的修饰符，还需要在运行时检查是否匹配到自定义的键位
    if (keys.length) {
      code += genKeyFilter(keys)
    }
    // Make sure modifiers like prevent and stop get executed after key filtering
    if (genModifierCode) {
      code += genModifierCode
    }
    // 对于指令的表达式是方法路径/函数表达式的情况，处理成函数调用的形式
    // 对于指令的表达式是内联 JavaScript 语句的形式，直接返回该语句
    const handlerCode = isMethodPath
      ? `return ${handler.value}($event)`
      : isFunctionExpression
        ? `return (${handler.value})($event)`
        : handler.value
    /* istanbul ignore if */
    if (__WEEX__ && handler.params) {
      return genWeexHandler(handler.params, code + handlerCode)
    }
    return `function($event){${code}${handlerCode}}`
  }
}

function genKeyFilter (keys: Array<string>): string {
  return `if(!('button' in $event)&&${keys.map(genFilterCode).join('&&')})return null;`
}

function genFilterCode (key: string): string {
  const keyVal = parseInt(key, 10)
  if (keyVal) {
    // 数字修饰符
    return `$event.keyCode!==${keyVal}`
  }
  const keyCode = keyCodes[key]
  const keyName = keyNames[key]
  return (
    `_k($event.keyCode,` +
    `${JSON.stringify(key)},` +
    `${JSON.stringify(keyCode)},` +
    `$event.key,` +
    `${JSON.stringify(keyName)}` +
    `)`
  )
}
