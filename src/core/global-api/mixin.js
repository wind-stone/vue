/* @flow */

/**
 * `Vue.mixin`方法，主要是将传入的`mixin`对象合并到构造函数`Vue`或其子类`SubVue`的`options`属性里，形成新的`Vue.options`或`SubVue.options`
 */

import { mergeOptions } from '../util/index'

export function initMixin (Vue: GlobalAPI) {
  Vue.mixin = function (mixin: Object) {
    this.options = mergeOptions(this.options, mixin)
    return this
  }
}
