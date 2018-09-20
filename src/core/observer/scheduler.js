/* @flow */
/**
 * 该文件主要是使用调度器以队列的方式批量处理`watcher`。
 *
 * 外部调用`queueWatcher(watcher)`函数后，做以下处理
 *  - 将新的`watcher`加入队列里
 *      - 若还未`flush`队列，则将`watcher`推进队列最后
 *      - 若正在`flush`队列，则按照`watcher`的`id`，将其插入到队列的相应位置
 *  - （在下一帧执行）`flush`队列
 *      - 若正在`flush`队列，则忽略此次操作
 *      - 若还未`flush`队列，则开始`flush`队列
 *          - 将队列里的所有`watcher`按照`id`从小到大排列
 *          - 顺序调用`watcher.run`方法，即重新计算`watcher`表达式的值、收集依赖、执行回调
 *          - 调用`activated`生命周期钩子函数（待学习）
 *          - 若队列里存在渲染`watcher`，则调用 vm 的`updated`生命周期钩子函数
 */
import type Watcher from './watcher'
import config from '../config'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import {
  warn,
  nextTick,
  devtools
} from '../util/index'

export const MAX_UPDATE_COUNT = 100

const queue: Array<Watcher> = []
const activatedChildren: Array<Component> = []
let has: { [key: number]: ?true } = {}
let circular: { [key: number]: number } = {}
let waiting = false
let flushing = false
let index = 0

/**
 * Reset the scheduler's state.
 */
function resetSchedulerState () {
  index = queue.length = activatedChildren.length = 0
  has = {}
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
  waiting = flushing = false
}

/**
 * Flush both queues and run the watchers.
 *
 * 将 wathcer 队列里的所有 watcher 排序后一一调用其 run 方法（重新计算表达式的值和收集依赖）
 *
 * 注意，在此过程中，是可以动态往队列里添加 wathcer 的
 */
function flushSchedulerQueue () {
  flushing = true
  let watcher, id

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child)
  // 2. A component's user watchers are run before its render watcher (because
  //    user watchers are created before the render watcher)
  // 3. If a component is destroyed during a parent component's watcher run,
  //    its watchers can be skipped.
  queue.sort((a, b) => a.id - b.id)

  // do not cache length because more watchers might be pushed
  // as we run existing watchers
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index]
    if (watcher.before) {
      watcher.before()
    }
    id = watcher.id
    has[id] = null
    watcher.run()
    // in dev build, check and stop circular updates.
    if (process.env.NODE_ENV !== 'production' && has[id] != null) {
      circular[id] = (circular[id] || 0) + 1
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' + (
            watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`
          ),
          watcher.vm
        )
        break
      }
    }
  }

  // keep copies of post queues before resetting state
  const activatedQueue = activatedChildren.slice()
  const updatedQueue = queue.slice()

  // 队列里的 wathcer 执行完后，重置调度器的状态，方便下次再次循环执行该队列
  resetSchedulerState()

  // call component updated and activated hooks
  // 调用 activated 钩子
  // TODO: 跟 keep-alive 有关，待之后分析
  callActivatedHooks(activatedQueue)

  // 调用 update 钩子
  callUpdatedHooks(updatedQueue)

  // devtool hook
  /* istanbul ignore if */
  if (devtools && config.devtools) {
    devtools.emit('flush')
  }
}

/**
 * 渲染 Watcher，在重新计算表达式后，调用 updated 钩子
 */
function callUpdatedHooks (queue) {
  let i = queue.length
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    if (vm._watcher === watcher && vm._isMounted) {
      callHook(vm, 'updated')
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent (vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false
  activatedChildren.push(vm)
}

function callActivatedHooks (queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 *
 * 将 watcher 推进 watcher 队列
 * （如果之前已经存在该 watcher && 且该 wathcer 还没执行，则选择忽略该 wathcer）
 */
export function queueWatcher (watcher: Watcher) {
  const id = watcher.id
  // 若当前 wathcer 没进行过 queueWatcher 处理，则进行如下处理；否则，忽略
  if (has[id] == null) {
    has[id] = true
    if (!flushing) {
      // 若是队列还没有 flush，则将当前 watcher 加入到队列末尾
      queue.push(watcher)
    } else {
      // if already flushing, splice the watcher based on its id
      // if already past its id, it will be run next immediately.
      // 若是队列里正在 flush，则将当前 watcher 按照 id 插入到队列里
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // queue the flush
    // 加锁，在下一个 tick 里 flush 队列
    if (!waiting) {
      waiting = true

      if (process.env.NODE_ENV !== 'production' && !config.async) {
        flushSchedulerQueue()
        return
      }
      nextTick(flushSchedulerQueue)
    }
  }
}
