/* not type checking this file because flow doesn't play well with Proxy */

/**
 * 非生产环境下，会通过原生的`Proxy`对象做一些代理操作，比如
 * - 给`config.keyCodes`添加代理，禁止通过`Vue.config.keyCodes`覆盖一些内置的修饰符，如
 *     - `stop`
 *    - `prevent`
 *     - `self`
 *     - `ctrl`
 *     - `shift`
 *     - `alt`
 *     - `meta`
 *     - `exact`
 * - 给`vm`添加代理`vm._renderProxy`，以下两种情况取其一：
 *     - `hasHandler`：判断对象具有某个属性时，如果这个属性不存在且不在允许访问的全局属性/方法列表内，则给出警告
 *     - `getHandler`：如果使用了对象的某个属性且该属性不存在，给出警告

 * 关于原生的`Proxy`使用，可参考：[阮一峰-ECMAScript 6 入门-Proxy](http://es6.ruanyifeng.com/#docs/proxy)
 */

import config from 'core/config'
import { warn, makeMap, isNative } from '../util/index'

let initProxy

if (process.env.NODE_ENV !== 'production') {
  const allowedGlobals = makeMap(
    'Infinity,undefined,NaN,isFinite,isNaN,' +
    'parseFloat,parseInt,decodeURI,decodeURIComponent,encodeURI,encodeURIComponent,' +
    'Math,Number,Date,Array,Object,Boolean,String,RegExp,Map,Set,JSON,Intl,' +
    'require' // for Webpack/Browserify
  )

  const warnNonPresent = (target, key) => {
    warn(
      `Property or method "${key}" is not defined on the instance but ` +
      'referenced during render. Make sure that this property is reactive, ' +
      'either in the data option, or for class-based components, by ' +
      'initializing the property. ' +
      'See: https://vuejs.org/v2/guide/reactivity.html#Declaring-Reactive-Properties.',
      target
    )
  }

  // 判断是否原生支持 Proxy
  const hasProxy =
    typeof Proxy !== 'undefined' && isNative(Proxy)

  if (hasProxy) {
    const isBuiltInModifier = makeMap('stop,prevent,self,ctrl,shift,alt,meta,exact')
    // 代理之后，设置 Vue.config.keyCodes 时，将先检测按键名是否与内置的按键名冲突
    config.keyCodes = new Proxy(config.keyCodes, {
      set (target, key, value) {
        if (isBuiltInModifier(key)) {
          warn(`Avoid overwriting built-in modifier in config.keyCodes: .${key}`)
          return false
        } else {
          target[key] = value
          return true
        }
      }
    })
  }

  // 使用 in 操作符检测对象里是否存在某个 key 时，若是不存在，且 key 不是全局的函数/属性，则警告
  const hasHandler = {
    // 拦截 propKey in proxy 的操作
    has (target, key) {
      const has = key in target
      const isAllowed = allowedGlobals(key) || (typeof key === 'string' && key.charAt(0) === '_')
      if (!has && !isAllowed) {
        warnNonPresent(target, key)
      }
      return has || !isAllowed
    }
  }

  // 获取不到 vm 上的方法或属性时，发出警告
  const getHandler = {
    get (target, key) {
      if (typeof key === 'string' && !(key in target)) {
        warnNonPresent(target, key)
      }
      return target[key]
    }
  }

  // 非生产环境下，vm._init 执行时会调用 initProxy(vm) 以对 vm 进行代理，当在模板里获取不到
  initProxy = function initProxy (vm) {
    if (hasProxy) {
      // determine which proxy handler to use
      const options = vm.$options
      const handlers = options.render && options.render._withStripped
        ? getHandler
        : hasHandler
      vm._renderProxy = new Proxy(vm, handlers)
    } else {
      vm._renderProxy = vm
    }
  }
}

export { initProxy }
