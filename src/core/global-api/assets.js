/* @flow */

/**
 * 在`Vue`上添加`componet/directive/filter`方法，通过这些方法注册的全局组件/指令/过滤器，将添加到`Vue.options.componets/directives/filters`上
 */

import { ASSET_TYPES } from 'shared/constants'
import { isPlainObject, validateComponentName } from '../util/index'

export function initAssetRegisters (Vue: GlobalAPI) {
  /**
   * Create asset registration methods.
   */
  ASSET_TYPES.forEach(type => {
    Vue[type] = function (
      id: string,
      definition: Function | Object
    ): Function | Object | void {
      if (!definition) {
        return this.options[type + 's'][id]
      } else {
        /* istanbul ignore if */
        if (process.env.NODE_ENV !== 'production' && type === 'component') {
          validateComponentName(id)
        }
        if (type === 'component' && isPlainObject(definition)) {
          // 组件优先使用组件对象的 name 属性
          definition.name = definition.name || id
          // definition 最终是基于父类扩展而来的子类（构造函数）
          // 父类不一定是 Vue，也可能是经过扩展的 Vue 子类

          // 最终挂载在`Vue.options.componets`的`definition`是经过处理后得到的构造函数，并不是原始的组件对象。
          definition = this.options._base.extend(definition)
        }
        if (type === 'directive' && typeof definition === 'function') {
          definition = { bind: definition, update: definition }
        }
        this.options[type + 's'][id] = definition
        return definition
      }
    }
  })
}
