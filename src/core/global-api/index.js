/* @flow */

/**
 * `Vue`构造函数创建好之后，需要给`Vue`挂载上一些方法和属性，列表如下：
 *
 * - `Vue.config`
 * - `Vue.util`
 *     - `Vue.util.warn`
 *     - `Vue.util.extend`
 *    - `Vue.util.mergeOptions`
 *     - `Vue.util.defineReactive`
 * - `Vue.set`（详见`../observer/index.md`）
 * - `Vue.delete`（详见`../observer/index.md`）
 * - `Vue.nextTick`（详见`../util/next-tick.md`）
 * - `Vue.options`
 *     - `Vue.options.components = { KeepAlive }`
 *     - `Vue.options.directives = {}`
 *     - `Vue.options.filters = {}`
 *     - `Vue.options._base = Vue`
 * - `Vue.use`（详见`./use.md`）
 * - `Vue.extend`（详见`./extend.md`）
 * - `Vue.mixin`（详见`./mixin.md`）
 * - `Vue.component`/`Vue.directive`/`Vue.filter`（详见同目录下`assets.md`）
 */

import config from '../config'
import { initUse } from './use'
import { initMixin } from './mixin'
import { initExtend } from './extend'
import { initAssetRegisters } from './assets'
import { set, del } from '../observer/index'
import { ASSET_TYPES } from 'shared/constants'
import builtInComponents from '../components/index'

import {
  warn,
  extend,
  nextTick,
  mergeOptions,
  defineReactive
} from '../util/index'

export function initGlobalAPI (Vue: GlobalAPI) {
  // config
  const configDef = {}
  configDef.get = () => config
  if (process.env.NODE_ENV !== 'production') {
    configDef.set = () => {
      warn(
        'Do not replace the Vue.config object, set individual fields instead.'
      )
    }
  }
  Object.defineProperty(Vue, 'config', configDef)

  // exposed util methods.
  // NOTE: these are not considered part of the public API - avoid relying on
  // them unless you are aware of the risk.
  Vue.util = {
    warn,
    extend,
    mergeOptions,
    defineReactive
  }

  Vue.set = set
  Vue.delete = del
  Vue.nextTick = nextTick

  Vue.options = Object.create(null)
  // 初始化 components、directives、filters
  ASSET_TYPES.forEach(type => {
    Vue.options[type + 's'] = Object.create(null)
  })

  // this is used to identify the "base" constructor to extend all plain-object
  // components with in Weex's multi-instance scenarios.
  Vue.options._base = Vue

  // 添加内置组件定义
  extend(Vue.options.components, builtInComponents)

  initUse(Vue)
  initMixin(Vue)
  initExtend(Vue)
  initAssetRegisters(Vue)
}
