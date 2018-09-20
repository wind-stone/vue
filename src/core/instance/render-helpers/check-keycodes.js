/* @flow */

import config from 'core/config'
import { hyphenate } from 'shared/util'

function isKeyNotMatch<T> (expect: T | Array<T>, actual: T): boolean {
  if (Array.isArray(expect)) {
    return expect.indexOf(actual) === -1
  } else {
    return expect !== actual
  }
}

/**
 * Runtime helper for checking keyCodes from config.
 * exposed as Vue.prototype._k
 * passing in eventKeyName as last argument separately for backwards compat
 */
/**
 * 检查配置里是否有自定义的键位别名
 */
export function checkKeyCodes (
  // 事件触发时实际的 $event.keyCode
  eventKeyCode: number,
  // 修饰符的名称
  key: string,
  // 修饰符可能存在的内置的 keyCode
  builtInKeyCode?: number | Array<number>,
  // 事件触发时实际的 $event.key
  eventKeyName?: string,
  // 修饰符可能存在的内置的 keyName
  builtInKeyName?: string | Array<string>
): ?boolean {
  const mappedKeyCode = config.keyCodes[key] || builtInKeyCode
  if (builtInKeyName && eventKeyName && !config.keyCodes[key]) {
    // 通过 $event.key 去判断是否匹配
    return isKeyNotMatch(builtInKeyName, eventKeyName)
  } else if (mappedKeyCode) {
    // 通过 $event.keyCode 去判断是否匹配
    return isKeyNotMatch(mappedKeyCode, eventKeyCode)
  } else if (eventKeyName) {
    // 将 $event.key 变成连字符形式，再去与修饰符匹配
    return hyphenate(eventKeyName) !== key
  }
}
