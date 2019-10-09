/* @flow */

/**
 * 提取出组件`data`里的`prop`
 *
 * 分析
 *
 * ```js
 * <template>
 *   <div class="root">
 *     <some-componet non-prop-attr="true"><some-component>
 *   </div>
 * </template>
 * ```
 *
 * 组件可能会存在[非 Prop 特性](https://cn.vuejs.org/v2/guide/components.html#%E9%9D%9E-Prop-%E7%89%B9%E6%80%A7)，
 * 对于没在组件内定义为`prop`的特性，会直接传入组件并被添加到组件的根元素上。
 */

import {
  tip,
  hasOwn,
  isDef,
  isUndef,
  hyphenate,
  formatComponentName
} from 'core/util/index'

/**
 * 根据组件选项对象里定义的 options.props，从数据对象 data.props/attrs 提取出 props 数据
 *
 * PS: 组件若是使用模板，在模板编译阶段，会将模板上的所有特性都提取到元素的数据对象`data.attrs`上；
 *     若是使用`render`函数，用户会将组件`props`相关的数据放置在数据对象`data.props`上。
 */
export function extractPropsFromVNodeData (
  data: VNodeData,
  Ctor: Class<Component>,
  tag?: string
): ?Object {
  // we are only extracting raw values here.
  // validation and default values are handled in the child
  // component itself.
  const propOptions = Ctor.options.props
  if (isUndef(propOptions)) {
    return
  }
  const res = {}
  const { attrs, props } = data
  if (isDef(attrs) || isDef(props)) {
    for (const key in propOptions) {
      const altKey = hyphenate(key)
      if (process.env.NODE_ENV !== 'production') {
        const keyInLowerCase = key.toLowerCase()
        if (
          key !== keyInLowerCase &&
          attrs && hasOwn(attrs, keyInLowerCase)
        ) {
          // 警告：prop 注册是 camelCased，但是在模板里使用时用的是 camelCased/camelcased
          // 在模板里使用时，应该用 camel-cased
          tip(
            `Prop "${keyInLowerCase}" is passed to component ` +
            `${formatComponentName(tag || Ctor)}, but the declared prop name is` +
            ` "${key}". ` +
            `Note that HTML attributes are case-insensitive and camelCased ` +
            `props need to use their kebab-case equivalents when using in-DOM ` +
            `templates. You should probably use "${altKey}" instead of "${key}".`
          )
        }
      }
      // 先从 props 里获取 prop，若获取不到，再从 attrs 里获取 prop
      // 需要注意，若是在 props 里获取到了 prop，要在 props 里保留该 prop；
      // 若是在 attrs 里获取到了 prop，则要将该 prop 从 attrs 里删除
      checkProp(res, props, key, altKey, true) ||
      checkProp(res, attrs, key, altKey, false)
    }
  }
  return res
}

/**
 * 检查 prop 是否存在在给定的 hash 里，若存在，添加到 res 里
 */
function checkProp (
  res: Object,
  hash: ?Object,
  key: string,
  altKey: string,
  preserve: boolean
): boolean {
  if (isDef(hash)) {
    if (hasOwn(hash, key)) {
      res[key] = hash[key]
      if (!preserve) {
        delete hash[key]
      }
      return true
    } else if (hasOwn(hash, altKey)) {
      res[key] = hash[altKey]
      if (!preserve) {
        delete hash[altKey]
      }
      return true
    }
  }
  return false
}
