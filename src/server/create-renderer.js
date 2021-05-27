/* @flow */

import RenderStream from './render-stream'
import { createWriteFunction } from './write'
import { createRenderFunction } from './render'
import { createPromiseCallback } from './util'
import TemplateRenderer from './template-renderer/index'
import type { ClientManifest } from './template-renderer/index'

export type Renderer = {
  renderToString: (component: Component, context: any, cb: any) => ?Promise<string>;
  renderToStream: (component: Component, context?: Object) => stream$Readable;
};

type RenderCache = {
  get: (key: string, cb?: Function) => string | void;
  set: (key: string, val: string) => void;
  has?: (key: string, cb?: Function) => boolean | void;
};

export type RenderOptions = {
  modules?: Array<(vnode: VNode) => ?string>;
  directives?: Object;
  isUnaryTag?: Function;
  cache?: RenderCache;
  template?: string | (content: string, context: any) => string;
  inject?: boolean;
  basedir?: string;
  shouldPreload?: Function;
  shouldPrefetch?: Function;
  clientManifest?: ClientManifest;
  serializer?: Function;
  runInNewContext?: boolean | 'once';
};

export function createRenderer ({
  modules = [],
  directives = {},
  isUnaryTag = (() => false),
  template,
  inject,
  cache,
  shouldPreload,
  shouldPrefetch,
  clientManifest,
  serializer
}: RenderOptions = {}): Renderer {

  // 创建 render 函数，该函数会将 Vue 实例渲染成字符串
  const render = createRenderFunction(modules, directives, isUnaryTag, cache)
  const templateRenderer = new TemplateRenderer({
    template,
    inject,
    shouldPreload,
    shouldPrefetch,
    clientManifest,
    serializer
  })

  return {
    renderToString (
      // 组件实例对象
      component: Component,
      // 用于模板插值
      context: any,
      // 回调函数，可以不传，会封装成 promise 形式
      cb: any
    ): ?Promise<string> {
      // 处理不传入 context 的情况
      if (typeof context === 'function') {
        cb = context
        context = {}
      }
      if (context) {
        // 往 context 上挂载 rendererResourceHints/rendererState/rendererScripts/rendererStyles/getPreloadFiles 等方法
        templateRenderer.bindRenderFns(context)
      }

      // 处理不传入 cb 的情况
      // 没有传 cb（形如 (err, html) => { ... } 的函数），则新创建一个 cb 并返回 promise；等到调用 cb 后，会触发 promise 的 resolve/reject
      // no callback, return Promise
      let promise
      if (!cb) {
        ({ promise, cb } = createPromiseCallback())
      }

      let result = ''
      // 该方法之后会挂在 context.write 上，并可通过 context.write.caching 确定是否要进行对写入的内容进行缓存
      const write = createWriteFunction(text => {
        result += text
        return false
      // 传入 cb 主要是用于内部错误的时候使用
      }, cb)
      try {
        // 调用 render 函数，将 Vue 实例渲染成字符串
        render(component, write, context, err => {
          if (err) {
            return cb(err)
          }
          if (context && context.rendered) {
            context.rendered(context)
          }
          if (template) {
            try {
              // 若是存在模板，则将组件的渲染结果字符串和模板结合一下再返回
              const res = templateRenderer.render(result, context)
              if (typeof res !== 'string') {
                // function template returning promise
                res
                  .then(html => cb(null, html))
                  .catch(cb)
              } else {
                cb(null, res)
              }
            } catch (e) {
              cb(e)
            }
          } else {
            cb(null, result)
          }
        })
      } catch (e) {
        cb(e)
      }

      // 始终返回 promise。
      // 针对传入 cb 的情况，这个 promise 是 undefined，开发者不需要关心这个返回值
      // 针对未传入 cb 的情况，经过 createPromiseCallback() 重新赋值 promise 和 cb 后，在调用 cb 后，会触发 promise 的 resolve/reject
      return promise
    },

    renderToStream (
      component: Component,
      context?: Object
    ): stream$Readable {
      if (context) {
        templateRenderer.bindRenderFns(context)
      }
      const renderStream = new RenderStream((write, done) => {
        render(component, write, context, done)
      })
      if (!template) {
        if (context && context.rendered) {
          const rendered = context.rendered
          renderStream.once('beforeEnd', () => {
            rendered(context)
          })
        }
        return renderStream
      } else if (typeof template === 'function') {
        throw new Error(`function template is only supported in renderToString.`)
      } else {
        const templateStream = templateRenderer.createStream(context)
        renderStream.on('error', err => {
          templateStream.emit('error', err)
        })
        renderStream.pipe(templateStream)
        if (context && context.rendered) {
          const rendered = context.rendered
          renderStream.once('beforeEnd', () => {
            rendered(context)
          })
        }
        return templateStream
      }
    }
  }
}
