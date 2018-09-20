# hooks 钩子源码学习及收获

vnode 对应的 DOM 元素创建、更新、销毁时，需要对以下模块进行处理：

- `attrs`
- `class`
- `dom-props`
- `events`
- `style`
- `transition`

针对这些模块，主要提供了`create`、`update`、`destroy`等公共钩子函数。


## 分析

### `create`钩子

`create`钩子是在 DOM 元素创建之后、插入到父元素之前调用，给 DOM 元素添加`class`、`attributes`、`style`、`events`等等。

需要注意的是，不止是 DOM 元素创建之后会调用`create`钩子，组件创建之后，也会调用`create`钩子。
