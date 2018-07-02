## 待学习问题


###  VNode 数据对象中的`attrs`和`domProps`

`domProps`包含的属性：
- `innerHTML`：通过`v-html`添加到元素上
- `textContent`：通过`v-text`添加到元素上
- `checked`：待学习
- `value`：待学习


### 如何处理模板里元素上的`class`和`style`绑定的？

元素在`patch`过程中新创建（`create`钩子里）或者更新后（`update`钩子），都会将 VNode 节点上的`class`/`staticClass`、`style`/`staticStyle`转换过为最终的字符串值，具体的转换方式详见：

- class
  - `/src/platforms/web/runtime/modules/class.js`
  - `/src/platforms/web/util/class.js`

- style
  - `/src/platforms/web/runtime/modules/style.js`
  - `/src/platforms/web/util/style.js`