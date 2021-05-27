/* @flow */

import { isUndef } from 'shared/util'

type RenderState = {
  type: 'Element';
  rendered: number;
  total: number;
  children: Array<VNode>;
  endTag: string;
} | {
  type: 'Fragment';
  rendered: number;
  total: number;
  children: Array<VNode>;
} | {
  type: 'Component';
  prevActive: Component;
} | {
  type: 'ComponentWithCache';
  buffer: Array<string>;
  bufferIndex: number;
  componentBuffer: Array<Set<Class<Component>>>;
  key: string;
};

/**
 * 创建服务端渲染的 context
 */
export class RenderContext {
  userContext: ?Object;
  activeInstance: Component;
  renderStates: Array<RenderState>;
  write: (text: string, next: Function) => void;
  renderNode: (node: VNode, isRoot: boolean, context: RenderContext) => void;
  next: () => void;
  done: (err: ?Error) => void;

  modules: Array<(node: VNode) => ?string>;
  directives: Object;
  isUnaryTag: (tag: string) => boolean;

  cache: any;
  get: ?(key: string, cb: Function) => void;
  has: ?(key: string, cb: Function) => void;

  constructor (options: Object) {
    this.userContext = options.userContext
    this.activeInstance = options.activeInstance
    this.renderStates = []

    this.write = options.write
    this.done = options.done
    this.renderNode = options.renderNode

    this.isUnaryTag = options.isUnaryTag
    this.modules = options.modules
    this.directives = options.directives

    const cache = options.cache
    if (cache && (!cache.get || !cache.set)) {
      throw new Error('renderer cache must implement at least get & set.')
    }
    this.cache = cache
    this.get = cache && normalizeAsync(cache, 'get')
    this.has = cache && normalizeAsync(cache, 'has')

    this.next = this.next.bind(this)
  }

  /**
   * 将 context.renderStates 数组里的每一个元素的子节点都转为字符串，最后追加关闭标签
   * 该函数一般会作为 context.write 的回调函数，即在 context.write 一个元素开始标签之后，将该元素的所有子节点和关闭标签也 write
   */
  next () {
    // eslint-disable-next-line
    while (true) {
      const lastState = this.renderStates[this.renderStates.length - 1]
      if (isUndef(lastState)) {
        return this.done()
      }
      /* eslint-disable no-case-declarations */
      switch (lastState.type) {
        case 'Element':
        case 'Fragment':
          // 这里会递归地调用元素的所有子节点进行 renderNode，等到所有子节点都渲染之后，该元素才算渲染结束，才会退出 renderStates 数组。
          // 因此这里要在当前元素上记录 rendered，表示下一个要渲染第几个子节点
          const { children, total } = lastState
          const rendered = lastState.rendered++
          if (rendered < total) {
            return this.renderNode(children[rendered], false, this)
          } else {
            this.renderStates.pop()
            if (lastState.type === 'Element') {
              return this.write(lastState.endTag, this.next)
            }
          }
          break
        case 'Component':
          this.renderStates.pop()
          this.activeInstance = lastState.prevActive
          break
        // TODO: 这里等回来再看
        case 'ComponentWithCache':
          this.renderStates.pop()
          const { buffer, bufferIndex, componentBuffer, key } = lastState
          const result = {
            html: buffer[bufferIndex],
            components: componentBuffer[bufferIndex]
          }
          this.cache.set(key, result)
          if (bufferIndex === 0) {
            // this is a top-level cached component,
            // exit caching mode.
            this.write.caching = false
          } else {
            // parent component is also being cached,
            // merge self into parent's result
            buffer[bufferIndex - 1] += result.html
            const prev = componentBuffer[bufferIndex - 1]
            result.components.forEach(c => prev.add(c))
          }
          buffer.length = bufferIndex
          componentBuffer.length = bufferIndex
          break
      }
    }
  }
}

function normalizeAsync (cache, method) {
  const fn = cache[method]
  if (isUndef(fn)) {
    return
  } else if (fn.length > 1) {
    return (key, cb) => fn.call(cache, key, cb)
  } else {
    return (key, cb) => cb(fn.call(cache, key))
  }
}
