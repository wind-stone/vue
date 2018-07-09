/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import { pushTarget, popTarget } from '../observer/dep'
import { isUpdatingChildComponent } from './lifecycle'

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving
} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute
} from '../util/index'

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}

export function proxy (target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

/**
 * 初始化组件的实例选项如`data`、`props`、`methods`、`computed`、`watchers`等，详情请查看同目录下的其他文件，分别针对各个选项进行了详细学习和分析
 */
export function initState (vm: Component) {
  vm._watchers = []
  const opts = vm.$options
  if (opts.props) initProps(vm, opts.props)
  if (opts.methods) initMethods(vm, opts.methods)
  if (opts.data) {
    initData(vm)
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  if (opts.computed) initComputed(vm, opts.computed)
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
}

/**
 * `initState`是初始化组件各个状态数据的，其首先处理的就是组件的`props`。
 * （因此，如果组件`data`选项里有`key`与`props`选项里的`key`冲突时，会提醒你`data`里的`key`不能用，而不是相反）
 *
 * 而在`initProps`函数里，主要做了如下处理：针对`props`里的每个`key`，

 * - `validateProp`：获取并验证`value`
 *    - 处理`value`为`Boolean`型的特殊情况
 *    - （如果需要）获取默认`value`，（如果需要）做响应式数据处理
 *    - 验证`value`是否符合`required`、`type`以及自定义验证函数
 *    - 返回`value`
 * - `defineReactive`：对`key`和`value`做响应式数据处理
 * - `proxy`：在`vm`上增加`key`属性并将对其的访问代理到`vm._props`上，从而简化对`props`的访问
 */
function initProps (vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {}
  const props = vm._props = {}
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  const keys = vm.$options._propKeys = []
  const isRoot = !vm.$parent
  // root instance props should be converted
  if (!isRoot) {
    toggleObserving(false)
  }
  for (const key in propsOptions) {
    keys.push(key)
    const value = validateProp(key, propsOptions, propsData, vm)
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      const hyphenatedKey = hyphenate(key)
      if (isReservedAttribute(hyphenatedKey) ||
          config.isReservedAttr(hyphenatedKey)) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      defineReactive(props, key, value, () => {
        if (vm.$parent && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
            `overwritten whenever the parent component re-renders. ` +
            `Instead, use a data or computed property based on the prop's ` +
            `value. Prop being mutated: "${key}"`,
            vm
          )
        }
      })
    } else {
      defineReactive(props, key, value)
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    // 注意此处，in 操作符枚举出原型上的所有属性，所以这里只会把组件独有的 prop 的访问挂载在 vm 上，而共有的 prop 会自动通过 vm.constructor.prototype 访问，详情请查看 Vue.extend 的实现
    if (!(key in vm)) {
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}

/**
 * `initData`是在`initMethods`、`initProps`之后，因此在`initData`的时候，需要检查`data`里每一`key`是否存在同名的`method`或者`prop`，如果有，则报错。
 */
function initData (vm: Component) {
  let data = vm.$options.data
  data = vm._data = typeof data === 'function'
    ? getData(data, vm)
    : data || {}
  if (!isPlainObject(data)) {
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) {
      proxy(vm, `_data`, key)
    }
  }
  // observe data
  observe(data, true /* asRootData */)
}

export function getData (data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  pushTarget()
  try {
    return data.call(vm, vm)
  } catch (e) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}

/**
 * 创建 Vue 实例/组件实例时，需要对`computed`计算属性做出处理，包括：
 * - 针对`computed`计算属性里的每个`key`，创建一个内部`watcher`
 * - 将`computed`计算属性里的每个`key`挂载到`vm`上，以便通过`vm`直接访问计算属性
 *     - 设置计算属性的`get`、`set`
 *     - 将计算属性的`key`/`value`通过`Object.defineProperty`挂载到`vm`上
 *
 * 注意事项
 * - 计算属性具有双重身份，即自身可能作为`dep`被依赖，也可能依赖其他`dep`。假设 A 依赖了当前的计算属性 B，而当前的计算属性 B 依赖了 C、D，则
 *     - 在获取计算属性 B 的值的过程中，计算属性将作为订阅者`watcher`，完成自身的求值之后，收集依赖
 *     - 当计算属性的依赖 C 或 D 改变时，计算属性仅仅是设置其对应的`watcher`实例的`lazy`属性为`true`，而其自身的值不会重新进行计算，只有当外部重新调用了计算属性才会重新计算值（因为计算属性是惰性计算的）
 *     - 每次获取计算属性的值以后，都会将 B 的依赖 C、D 添加为 A 的依赖（之所以是每次计算都这么做，是因为 B 的依赖可能会变）
 *     - 因此，每次 C、D 改变不会导致计算属性 B 的值改变（这就是为什么计算属性是 lazy 的），但是会通知 A 进行重新计算
 *     - 如果是通过`Vue.extend(options)`扩展而来的构造函数如`SubVue`，如果`options`里有`computed`选项，则这些计算属性的访问将通过`SubVue.prototype`访问，仅有组件独有的计算属性是通过`vm`直接访问的。`props`也是如此，详情请参考`Vue.extend`的实现及`initProps`的分析文档。
 */
const computedWatcherOptions = { computed: true }

function initComputed (vm: Component, computed: Object) {
  // $flow-disable-line
  const watchers = vm._computedWatchers = Object.create(null)
  // computed properties are just getters during SSR
  const isSSR = isServerRendering()

  for (const key in computed) {
    const userDef = computed[key]
    const getter = typeof userDef === 'function' ? userDef : userDef.get
    if (process.env.NODE_ENV !== 'production' && getter == null) {
      warn(
        `Getter is missing for computed property "${key}".`,
        vm
      )
    }

    if (!isSSR) {
      // create internal watcher for the computed property.
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        computedWatcherOptions
      )
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.

    // 注意此处，in 操作符枚举出原型上的所有属性，所以这里只会把组件独有的计算属性的访问挂载在 vm 上，而共有的计算属性会自动通过 vm.constructor.prototype 访问，详情请查看 Vue.extend 的实现
    if (!(key in vm)) {
      defineComputed(vm, key, userDef)
    } else if (process.env.NODE_ENV !== 'production') {
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      }
    }
  }
}

export function defineComputed (
  target: any,
  key: string,
  userDef: Object | Function
) {
  const shouldCache = !isServerRendering()
  if (typeof userDef === 'function') {
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
      : userDef
    sharedPropertyDefinition.set = noop
  } else {
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : userDef.get
      : noop
    sharedPropertyDefinition.set = userDef.set
      ? userDef.set
      : noop
  }
  if (process.env.NODE_ENV !== 'production' &&
      sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

function createComputedGetter (key) {
  return function computedGetter () {
    const watcher = this._computedWatchers && this._computedWatchers[key]
    if (watcher) {
      watcher.depend()
      return watcher.evaluate()
    }
  }
}


/**
 * 创建 Vue 实例/组件实例时，需要对`methods`做出简单的处理，包括：
 *
 * - （非 production 环境下）对各个方法进行校验
 * - 方法的`value`不能为`null`/`undefined`
 * - 方法的`key`不能与`props`里的`key`冲突
 * - 方法的`key`不能与已有的 Vue 实例方法名冲突
 * - 将方法内的`this`绑定到`vm`上
 * - 将方法挂载到`vm`上，以更加方便的引用
 */
function initMethods (vm: Component, methods: Object) {
  const props = vm.$options.props
  for (const key in methods) {
    if (process.env.NODE_ENV !== 'production') {
      if (methods[key] == null) {
        warn(
          `Method "${key}" has an undefined value in the component definition. ` +
          `Did you reference the function correctly?`,
          vm
        )
      }
      if (props && hasOwn(props, key)) {
        warn(
          `Method "${key}" has already been defined as a prop.`,
          vm
        )
      }
      if ((key in vm) && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
          `Avoid defining component methods that start with _ or $.`
        )
      }
    }
    vm[key] = methods[key] == null ? noop : bind(methods[key], vm)
  }
}

/**
 * watch 对象 key 的 value 可以是数组

 * 主要应用场景：使用`Vue.extend`、`Vue.mixin`或组件`extends`选项、`mixins`选项合并`watch`选项时，会将同名的`watch`合并成一个数组。

 * watch 对象 key 的 value 可以是数组，数组内的元素可以是函数、方法名、选项对象。

 * Vue 实例化阶段初始化 watch 选项时，如果 watch 对象 key 对应的 value 为数组，将循环取出数组里的元素并进行 watch。

  {
    name: 'App',
    data() {
      return {
        a: 1
      }
    },
    watch: {
      'a': [
        function () {
          console.log('1')
        },
        function () {
          console.log('2')
        },
        'watchAFn',
        {
          handler: () => {
            console.log('4')
          },
          immediate: true
        }
      ]
    },
    mounted() {
      setTimeout(() => {
        this.a = 2
      }, 2000)
    },
    methods: {
      watchAFn() {
        console.log('3')
      }
    }
  }
  // 4
  // 1
  // 2
  // 3
  // 4
 */
function initWatch (vm: Component, watch: Object) {
  for (const key in watch) {
    const handler = watch[key]
    if (Array.isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
      createWatcher(vm, key, handler)
    }
  }
}

function createWatcher (
  vm: Component,
  expOrFn: string | Function,
  handler: any,
  options?: Object
) {
  if (isPlainObject(handler)) {
    options = handler
    handler = handler.handler
  }
  if (typeof handler === 'string') {
    handler = vm[handler]
  }
  return vm.$watch(expOrFn, handler, options)
}


/**
 * 给`Vue.prototype`添加一些全局的属性和方法，如`$data`、`$props`、`$set`、`$delete`、`$watch`
 */
export function stateMixin (Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {}
  dataDef.get = function () { return this._data }
  const propsDef = {}
  propsDef.get = function () { return this._props }
  if (process.env.NODE_ENV !== 'production') {
    dataDef.set = function (newData: Object) {
      warn(
        'Avoid replacing instance root $data. ' +
        'Use nested data properties instead.',
        this
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  Object.defineProperty(Vue.prototype, '$data', dataDef)
  Object.defineProperty(Vue.prototype, '$props', propsDef)

  Vue.prototype.$set = set
  Vue.prototype.$delete = del

  Vue.prototype.$watch = function (
    expOrFn: string | Function,
    cb: any,
    options?: Object
  ): Function {
    const vm: Component = this
    if (isPlainObject(cb)) {
      return createWatcher(vm, expOrFn, cb, options)
    }
    options = options || {}
    options.user = true
    const watcher = new Watcher(vm, expOrFn, cb, options)
    if (options.immediate) {
      // 立即执行回调
      cb.call(vm, watcher.value)
    }
    return function unwatchFn () {
      watcher.teardown()
    }
  }
}
