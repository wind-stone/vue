/* @flow */

/**
 * 添加 Vue.component/directive/filter 方法
 *
 * 通过这些方法注册的全局组件/指令/过滤器，将添加到`Vue.options.componets/directives/filters`上
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
        // 获取 id 对应的定义对象/函数
        return this.options[type + 's'][id]
      } else {
        /* istanbul ignore if */
        if (process.env.NODE_ENV !== 'production' && type === 'component') {
          validateComponentName(id)
        }
        if (type === 'component' && isPlainObject(definition)) {
          // 组件优先使用组件对象的 name 属性
          definition.name = definition.name || id
          // 将注册的组件选项对象转换为经过 Vue.extend 处理过的继承了 Vue 的构造函数
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
