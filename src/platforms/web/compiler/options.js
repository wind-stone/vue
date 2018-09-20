/* @flow */

import {
  isPreTag,
  mustUseProp,
  isReservedTag,
  getTagNamespace
} from '../util/index'

import modules from './modules/index'
import directives from './directives/index'
import { genStaticKeys } from 'shared/util'
import { isUnaryTag, canBeLeftOpenTag } from './util'

export const baseOptions: CompilerOptions = {
  expectHTML: true,
  modules,
  directives,
  // 函数，判断是否是 <pre> 标签
  isPreTag,
  // 函数，判断是否是一元标签，即一定不会自我闭合，比如 <br>、<hr>
  isUnaryTag,
  // 函数，判断哪些标签的那些 attribute 需要用 props 来实现数据绑定
  mustUseProp,
  // 函数，判断哪些标签是无需显示闭合的
  canBeLeftOpenTag,
  // 保留标签（HTML 标签及 SVG 标签）
  isReservedTag,
  // 函数，获取标签的命名空间
  getTagNamespace,
  // 提取模块里的静态 keys，其结构为：'staticClass,staticStyle'
  staticKeys: genStaticKeys(modules)
}
