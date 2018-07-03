# slot 的生成和渲染

## slot 的模板解析

将`template`解析并生成`render`函数时，会对`slot`做如下处理。
（前提：已经解析了`slot`标签、元素的`slot`特性和`scope`/`slot-scope`特性，并生成了 ASTElement）

```js
// @file src/compiler/parser/index.js

/**
 * 处理 slot 相关，分为两类：
 * 1. slot 标签（子组件里的 slot 标签，会将父组件对应的 slot 内容渲染出来）
 *   - 最终增加 el.slotName 属性
 * 2. 元素的 slot 特性，包括 slot、scope/slot-scope（父组件内使用子组件时传入的内容）
 *   - 最终增加 el.slotTarget 属性，对应的元素 slot 特性的值
 *   - （可选的）增加 el.slotScope 属性，表明这个是作用域插槽
 */
function processSlot (el) {
  if (el.tag === 'slot') {
    // （子组件模板内）slot 标签
    el.slotName = getBindingAttr(el, 'name')
    if (process.env.NODE_ENV !== 'production' && el.key) {
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
        `and can possibly expand into multiple elements. ` +
        `Use the key on a wrapping element instead.`
      )
    }
  } else {
    // （父组件模板内，定义的子组件<child></child>里）要分发的内容
    let slotScope

    // 处理 scoped slot
    if (el.tag === 'template') {
      // 示例：
      // <template slot-scope="props">
      //   <span>hello from parent</span>
      //   <span>{{ props.text }}</span>
      // </template>
      slotScope = getAndRemoveAttr(el, 'scope')
      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' && slotScope) {
        warn(
          `the "scope" attribute for scoped slots have been deprecated and ` +
          `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
          `can also be used on plain elements in addition to <template> to ` +
          `denote scoped slots.`,
          true
        )
      }
      el.slotScope = slotScope || getAndRemoveAttr(el, 'slot-scope')
    } else if ((slotScope = getAndRemoveAttr(el, 'slot-scope'))) {
      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' && el.attrsMap['v-for']) {
        warn(
          `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
          `(v-for takes higher priority). Use a wrapper <template> for the ` +
          `scoped slot to make it clearer.`,
          true
        )
      }
      el.slotScope = slotScope
    }
    // 分发内容对应的 slot 名称
    const slotTarget = getBindingAttr(el, 'slot')
    if (slotTarget) {
      el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget
      // preserve slot as an attribute for native shadow DOM compat
      // only for non-scoped slots.
      // 若是一般插槽（非作用域插槽），将要分发到的 slot 的名称保存在元素的 slot 特性里
      if (el.tag !== 'template' && !el.slotScope) {
        addAttr(el, 'slot', slotTarget)
      }
    }
  }
}
```

随后，针对作用域插槽`slotScope`的分发内容做特殊处理：将作用域插槽的名称和对应元素存储在父元素的 `scopedSlots`对象里，方便以后在渲染`slot`的时候使用。

```js
// @file src/compiler/parser/index.js

if (currentParent && !element.forbidden) {
  if (element.elseif || element.else) {
    processIfConditions(element, currentParent)
  } else if (element.slotScope) { // scoped slot
    // 将作用域插槽放入父元素的 scopedSlots 里，而不是作为父元素的 child
    currentParent.plain = false
    const name = element.slotTarget || '"default"'
    ;(currentParent.scopedSlots || (currentParent.scopedSlots = {}))[name] = element
  } else {
    currentParent.children.push(element)
    element.parent = currentParent
  }
}
```

## 生成`render`函数

解析完模板之后，需要通过模板生成最终的`render`函数。

### `slot`特性

示例：

```html
<parent-component>
  <child-component>
    <template slot="header">
      <h1>Here might be a page title</h1>
    </template>

    <p>A paragraph for the main content.</p>
    <p>And another one.</p>

    <p slot="footer">Here's some contact info</p>
  <child-component>
</parent-component>
```

在`render`函数生成阶段生成元素的`data`时，若遇到有`slot`、`scope`/`slot-scope`特性的元素，则进行对应处理。

- `slot`（普通插槽）：`data.slot = el.slotTarget`
- `scope`/`slot-scope`（作用域插槽）：`data.scopedSlots = _u([{ key, fn }])`

```js
export function genData (el: ASTElement, state: CodegenState): string {
  let data = '{'
  // ...

  // slot target
  // only for non-scoped slots
  // 普通插槽
  if (el.slotTarget && !el.slotScope) {
    data += `slot:${el.slotTarget},`
  }
  // scoped slots
  // 该元素拥有的所有的作用域插槽（带模板内容）
  if (el.scopedSlots) {
    data += `${genScopedSlots(el.scopedSlots, state)},`
  }

  // ...
  return data
}

function genScopedSlots (
  slots: { [key: string]: ASTElement },
  state: CodegenState
): string {
  return `scopedSlots:_u([${
    Object.keys(slots).map(key => {
      return genScopedSlot(key, slots[key], state)
    }).join(',')
  }])`
}

/**
 * 获取 scoped slot 模板函数，最终 data.scopedSlots 的数据结构是 { key: fn, ... }
 * @param {*} key slot 的名称
 * @param {*} el 分发内容的元素
 * @param {*} state
 */
function genScopedSlot (
  key: string,
  el: ASTElement,
  state: CodegenState
): string {
  if (el.for && !el.forProcessed) {
    return genForScopedSlot(key, el, state)
  }
  // 生成分发内容模板函数
  const fn = `function(${String(el.slotScope)}){` +
    `return ${el.tag === 'template'
      ? el.if
        ? `${el.if}?${genChildren(el, state) || 'undefined'}:undefined`
        : genChildren(el, state) || 'undefined'
      : genElement(el, state)
    }}`
  return `{key:${key},fn:${fn}}`
}

// 即 _u 函数
export function resolveScopedSlots (
  fns: ScopedSlotsData, // see flow/vnode
  res?: Object
): { [key: string]: Function } {
  res = res || {}
  for (let i = 0; i < fns.length; i++) {
    if (Array.isArray(fns[i])) {
      resolveScopedSlots(fns[i], res)
    } else {
      res[fns[i].key] = fns[i].fn
    }
  }
  return res
}
```


### `slot`标签

示例：

```html
<child-component>
  <div class="container">
    <header>
      <slot name="header"></slot>
    </header>
    <main>
      <slot></slot>
    </main>
    <footer>
      <slot name="footer"></slot>
    </footer>
  </div>
</child-component>
```

在生成`child-component`组件的`render`函数时，若遇到`slot`标签，需要进行特殊处理，最后返回的代码类似于`_t(slotName, children, attrs对象, bind对象)`，其中`_t()`函数包裹的代码将在运行时执行，执行时返回组件外部的分发内容生成的 Vnode。

```js
export function genElement (el: ASTElement, state: CodegenState): string {
  if (el.staticRoot && !el.staticProcessed) {
    // el 是静态根节点 && 没经过 genStatic 处理
    return genStatic(el, state)
  } else if (el.once && !el.onceProcessed) {
    return genOnce(el, state)
  } else if (el.for && !el.forProcessed) {
    return genFor(el, state)
  } else if (el.if && !el.ifProcessed) {
    return genIf(el, state)
  } else if (el.tag === 'template' && !el.slotTarget) {
    return genChildren(el, state) || 'void 0'
  } else if (el.tag === 'slot') {
    return genSlot(el, state)
  } else {
    // ...
  }
}

/**
 * 生成 slot 标签的内容（针对 el.tag 为 slot 的标签）
 *
 * 最终拼装成 _t(slotName, children, attrs对象, bind对象)
 */
function genSlot (el: ASTElement, state: CodegenState): string {
  const slotName = el.slotName || '"default"'
  // children 是 slot 标签内的节点，若该 slot 没有分发内容，则显示默认内容即 children
  const children = genChildren(el, state)
  let res = `_t(${slotName}${children ? `,${children}` : ''}`
  const attrs = el.attrs && `{${el.attrs.map(a => `${camelize(a.name)}:${a.value}`).join(',')}}`
  const bind = el.attrsMap['v-bind']
  if ((attrs || bind) && !children) {
    res += `,null`
  }
  if (attrs) {
    res += `,${attrs}`
  }
  if (bind) {
    res += `${attrs ? '' : ',null'},${bind}`
  }
  return res + ')'
}
```



## 执行`render`函数，渲染`slot`节点

上一步的`_t()`函数实际上就是`renderSlot`的别名。`renderSlot`函数在运行时`render`函数执行的时候才真正执行。

若是一般的插槽，将获取到组件实例上的`$slots[slotName]`的 Vnode 节点

若是作用域插槽，则将获取到组件实例上的`$scopedSlots[name]`函数，实时生成 Vnode 节点

```js
/**
 * Runtime helper for rendering <slot>
 */
export function renderSlot (
  name: string,
  // fallback 是 slot 标签内的节点，若该 slot 没有分发内容，则显示默认内容即 fallback
  fallback: ?Array<VNode>,
  props: ?Object,
  bindObject: ?Object
): ?Array<VNode> {
  const scopedSlotFn = this.$scopedSlots[name]
  let nodes
  if (scopedSlotFn) { // scoped slot
    props = props || {}
    if (bindObject) {
      if (process.env.NODE_ENV !== 'production' && !isObject(bindObject)) {
        warn(
          'slot v-bind without argument expects an Object',
          this
        )
      }
      props = extend(extend({}, bindObject), props)
    }
    // 生成 vnode 节点
    nodes = scopedSlotFn(props) || fallback
  } else {
    const slotNodes = this.$slots[name]
    // warn duplicate slot usage
    if (slotNodes) {
      if (process.env.NODE_ENV !== 'production' && slotNodes._rendered) {
        warn(
          `Duplicate presence of slot "${name}" found in the same render tree ` +
          `- this will likely cause render errors.`,
          this
        )
      }
      slotNodes._rendered = true
    }
    nodes = slotNodes || fallback
  }

  // target 为 slot 的名称
  const target = props && props.slot
  if (target) {
    // 一般插槽：生成分发内容的 Vnode，target 为要分发到的 slot 名称
    return this.$createElement('template', { slot: target }, nodes)
  } else {
    // 作用域插槽
    return nodes
  }
}
```


### 实例的`$slots`是怎么来的

```js
export function initRender (vm: Component) {
  // ...
  const options = vm.$options
  const parentVnode = vm.$vnode = options._parentVnode // the placeholder node in parent tree
  const renderContext = parentVnode && parentVnode.context
  vm.$slots = resolveSlots(options._renderChildren, renderContext)
  // ...
}

/**
 * Runtime helper for resolving raw children VNodes into a slot object.
 * 返回 vnode 节点所有的 slots 对象
 * { key: slot数组 }
 */
export function resolveSlots (
  children: ?Array<VNode>,
  context: ?Component
): { [key: string]: Array<VNode> } {
  const slots = {}
  if (!children) {
    return slots
  }
  for (let i = 0, l = children.length; i < l; i++) {
    const child = children[i]
    const data = child.data
    // remove slot attribute if the node is resolved as a Vue slot node
    if (data && data.attrs && data.attrs.slot) {
      delete data.attrs.slot
    }
    // named slots should only be respected if the vnode was rendered in the
    // same context.
    if ((child.context === context || child.fnContext === context) &&
      data && data.slot != null
    ) {
      // 命名插槽
      const name = data.slot
      const slot = (slots[name] || (slots[name] = []))
      if (child.tag === 'template') {
        slot.push.apply(slot, child.children || [])
      } else {
        slot.push(child)
      }
    } else {
      // 默认插槽
      (slots.default || (slots.default = [])).push(child)
    }
  }
  // ignore slots that contains only whitespace
  for (const name in slots) {
    if (slots[name].every(isWhitespace)) {
      delete slots[name]
    }
  }
  return slots
}
```


### 实例的`$scopedSlots`是怎么来的

```js
Vue.prototype._render = function (): VNode {
  const vm: Component = this
  // 若是组件实例，则会存在 _parentVnode
  const { render, _parentVnode } = vm.$options
  // ...
  if (_parentVnode) {
    vm.$scopedSlots = _parentVnode.data.scopedSlots || emptyObject
  }
  // ...
}
```

### 默认前提条件说明

- 通过`render`函数生成`child-component`组件的 Vnode 节点之前，`child-component`组件内的节点已经渲染完成，并作为`child-component`组件占位节点的的`children`存在

```html
<parent-component>
  <child-component>
    <template slot="header">
      <h1>Here might be a page title</h1>
    </template>

    <p>A paragraph for the main content.</p>
    <p>And another one.</p>

    <p slot="footer">Here's some contact info</p>
  <child-component>
</parent-component>
```

- 一般插槽和作用域插槽生成 Vnode 的时机不同

如上一条所说，一般插槽是在`child-component`组件自身生成 Vnode 节点之前就已经生成 Vnode 节点。

而作用域插槽，是在`child-component`组件自身生成 Vnode 节点时，实时生成 Vnode 节点的，而且作用域插槽分发内容的节点，不作为`child-component`组件的子节点存在（不存在在 AST 的节点树里，而是作为`child-component`组件）
