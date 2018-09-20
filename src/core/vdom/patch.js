/**
 * Virtual DOM patching algorithm based on Snabbdom by
 * Simon Friis Vindum (@paldepind)
 * Licensed under the MIT License
 * https://github.com/paldepind/snabbdom/blob/master/LICENSE
 *
 * modified by Evan You (@yyx990803)
 *
 * Not type-checking this because this file is perf-critical and the cost
 * of making flow understand it is not worth it.
 */

import VNode, { cloneVNode } from './vnode'
import config from '../config'
import { SSR_ATTR } from 'shared/constants'
import { registerRef } from './modules/ref'
import { traverse } from '../observer/traverse'
import { activeInstance } from '../instance/lifecycle'
import { isTextInputType } from 'web/util/element'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  makeMap,
  isRegExp,
  isPrimitive
} from '../util/index'

export const emptyNode = new VNode('', {}, [])

const hooks = ['create', 'activate', 'update', 'remove', 'destroy']

/**
 * 判断两个 VNode 节点是否是同一种 VNode
 */
function sameVnode (a, b) {
  return (
    a.key === b.key && (
      (
        // 若是元素类型的 VNode，则需要相同的元素标签；若是组件占位 VNode，则需要是相同组件的 VNode
        a.tag === b.tag &&
        // 都是注释 VNode，或都不是注释 VNode
        a.isComment === b.isComment &&
        // VNode 的 data 都定义了，或都没定义
        isDef(a.data) === isDef(b.data) &&
        // （对于 input 输入框来说），相同的输入类型
        sameInputType(a, b)
      ) || (
        // 对于异步组件占位 VNode 来说，工厂函数要完全相同；且新的异步组件占位 VNode 不能是失败状态
        isTrue(a.isAsyncPlaceholder) &&
        a.asyncFactory === b.asyncFactory &&
        isUndef(b.asyncFactory.error)
      )
    )
  )
}

/**
 * 判断两个 VNode 是否是同一种 input 输入类型
 */
function sameInputType (a, b) {
  // 若不是 input 标签，返回 true
  if (a.tag !== 'input') return true
  let i
  const typeA = isDef(i = a.data) && isDef(i = i.attrs) && i.type
  const typeB = isDef(i = b.data) && isDef(i = i.attrs) && i.type
  // input 的 type 相同或者两个 input 都是文本输入类型
  return typeA === typeB || isTextInputType(typeA) && isTextInputType(typeB)
}


/**
 * 返回对象，对象的 key 是子 VNode 的 vnode.key，value 是子 VNode 的索引
 */
function createKeyToOldIdx (children, beginIdx, endIdx) {
  let i, key
  const map = {}
  for (i = beginIdx; i <= endIdx; ++i) {
    key = children[i].key
    if (isDef(key)) map[key] = i
  }
  return map
}

export function createPatchFunction (backend) {
  let i, j
  const cbs = {}

  const { modules, nodeOps } = backend

  // 将针对 refs 和 directives 等模块的 create、update、destroy 钩子合并到 cbs 里
  for (i = 0; i < hooks.length; ++i) {
    cbs[hooks[i]] = []
    for (j = 0; j < modules.length; ++j) {
      if (isDef(modules[j][hooks[i]])) {
        cbs[hooks[i]].push(modules[j][hooks[i]])
      }
    }
  }

  /**
   * 以 DOM 元素节点为基础，创建 VNode 节点（仅包含 tag 和 elm）
   */
  function emptyNodeAt (elm) {
    return new VNode(nodeOps.tagName(elm).toLowerCase(), {}, [], undefined, elm)
  }

  /**
   * 创建删除回调，调用 listeners 后，元素即被删除
   * @param {Element} childElm 待删除的 DOM 元素节点
   * @param {Number} listeners 待调用的次数，达到调用次数后即删除元素
   */
  function createRmCb (childElm, listeners) {
    function remove () {
      if (--remove.listeners === 0) {
        removeNode(childElm)
      }
    }
    remove.listeners = listeners
    return remove
  }

  /**
   * 移除 DOM 节点
   */
  function removeNode (el) {
    const parent = nodeOps.parentNode(el)
    // element may have already been removed due to v-html / v-text
    if (isDef(parent)) {
      nodeOps.removeChild(parent, el)
    }
  }

  function isUnknownElement (vnode, inVPre) {
    return (
      !inVPre &&
      !vnode.ns &&
      !(
        config.ignoredElements.length &&
        config.ignoredElements.some(ignore => {
          return isRegExp(ignore)
            ? ignore.test(vnode.tag)
            : ignore === vnode.tag
        })
      ) &&
      config.isUnknownElement(vnode.tag)
    )
  }

  let creatingElmInVPre = 0

  /**
   * 为 VNode 创建对应的 DOM 节点/组件实例
   *
   * @param {*} vnode 虚拟节点
   * @param {*} insertedVnodeQueue
   * @param {*} parentElm 父元素
   * @param {*} refElm nextSibling 节点，如果有，插入到父节点之下该节点之前
   * @param {*} nested 是否是嵌套创建元素，在 createChildren 里调用 createElm 时，该值为 true
   * @param {*} ownerArray 若 VNode 来源于某个 VNode 类型的数组，该参数即为该数组（比如该 VNode 是 vnodeParent 的子节点，ownerArray 即为 vnodeParent.children）
   * @param {*} index VNode 在 ownerArray 中的索引
   */
  function createElm (
    vnode,
    insertedVnodeQueue,
    parentElm,
    refElm,
    nested,
    ownerArray,
    index
  ) {
    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // This vnode was used in a previous render!
      // now it's used as a new node, overwriting its elm would cause
      // potential patch errors down the road when it's used as an insertion
      // reference node. Instead, we clone the node on-demand before creating
      // associated DOM element for it.

      // 若 vnode 的节点如果已经创建，则克隆一份 vnode，再继续向下走
      vnode = ownerArray[index] = cloneVNode(vnode)
    }

    vnode.isRootInsert = !nested // for transition enter check

    // 组件占位 VNode：创建组件实例以及创建整个组件的 DOM Tree，（若 parentElm 存在）并插入到父元素上
    if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
      return
    }

    // 非组件占位 VNode（正常 HTML 元素、注释、文本节点）
    const data = vnode.data
    const children = vnode.children
    const tag = vnode.tag
    if (isDef(tag)) {
      // 元素类型的 VNode
      if (process.env.NODE_ENV !== 'production') {
        if (data && data.pre) {
          creatingElmInVPre++
        }
        if (isUnknownElement(vnode, creatingElmInVPre)) {
          // 未知/未注册节点，警告
          warn(
            'Unknown custom element: <' + tag + '> - did you ' +
            'register the component correctly? For recursive components, ' +
            'make sure to provide the "name" option.',
            vnode.context
          )
        }
      }

      // 创建 DOM 元素节点
      vnode.elm = vnode.ns
        ? nodeOps.createElementNS(vnode.ns, tag)
        : nodeOps.createElement(tag, vnode)
      setScope(vnode)

      /* istanbul ignore if */
      if (__WEEX__) {
        // in Weex, the default insertion order is parent-first.
        // List items can be optimized to use children-first insertion
        // with append="tree".
        const appendAsTree = isDef(data) && isTrue(data.appendAsTree)
        if (!appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue)
          }
          insert(parentElm, vnode.elm, refElm)
        }
        createChildren(vnode, children, insertedVnodeQueue)
        if (appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue)
          }
          insert(parentElm, vnode.elm, refElm)
        }
      } else {
        // 创建子 DOM 节点
        createChildren(vnode, children, insertedVnodeQueue)
        if (isDef(data)) {
          // 调用 create 钩子
          invokeCreateHooks(vnode, insertedVnodeQueue)
        }
        // 将 VNode 的 DOM 节点，插入到父元素
        // 因为是递归调用 createElement，因此创建元素的过程是先父后子，将子元素插入到父元素的过程是先子后父
        insert(parentElm, vnode.elm, refElm)
      }

      if (process.env.NODE_ENV !== 'production' && data && data.pre) {
        creatingElmInVPre--
      }
    } else if (isTrue(vnode.isComment)) {
      // 注释类型的 VNode
      vnode.elm = nodeOps.createComment(vnode.text)
      insert(parentElm, vnode.elm, refElm)
    } else {
      // 文本类型的 VNode
      vnode.elm = nodeOps.createTextNode(vnode.text)
      insert(parentElm, vnode.elm, refElm)
    }
  }

  /**
   * 创建组件占位 VNode 的组件实例
   * @param {*} vnode 组件占位 VNode
   * @param {*} insertedVnodeQueue
   * @param {*} parentElm DOM 父元素节点
   * @param {*} refElm DOM nextSibling 元素节点，如果存在，组件将插入到 parentElm 之下，refElm 之前
   */
  function createComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
    let i = vnode.data
    if (isDef(i)) {
      // 是否是重新激活的节点（keep-alive 的组件 activated 了）
      const isReactivated = isDef(vnode.componentInstance) && i.keepAlive
      if (isDef(i = i.hook) && isDef(i = i.init)) {
        // 若是 vnode.data.hook.init 存在（该方法是在 create-component.js 里创建组件的 Vnode 时添加的）
        // 说明是组件占位 VNode，则调用 init 方法创建组件实例 vnode.componentInstance
        i(vnode, false /* hydrating */)
      }
      // after calling the init hook, if the vnode is a child component
      // it should've created a child instance and mounted it. the child
      // component also has set the placeholder vnode's elm.
      // in that case we can just return the element and be done.
      // 注释翻译：
      // 若是该 VNode 是子组件（的占位 VNode），调用 init 钩子方法后，该 VNode 将创建子组件实例并挂载了
      // 子组件也设置了占位 VNode 的 vnode.elm。此种情况，我们就能返回 true 表明完成了组件实例的创建。
      if (isDef(vnode.componentInstance)) {
        // 初始化
        initComponent(vnode, insertedVnodeQueue)
        // 将组件 DOM 根节点插入到父元素下
        insert(parentElm, vnode.elm, refElm)
        if (isTrue(isReactivated)) {
          reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm)
        }
        return true
      }
    }
  }

  /**
   * 初始化组件实例
   */
  function initComponent (vnode, insertedVnodeQueue) {
    if (isDef(vnode.data.pendingInsert)) {
      // 将子组件在创建 DOM Tree 过程中新增的所有带 insert 钩子的 VNode 数组添加到 insertedVnodeQueue 中
      insertedVnodeQueue.push.apply(insertedVnodeQueue, vnode.data.pendingInsert)
      vnode.data.pendingInsert = null
    }
    // 获取到组件实例的 DOM 根元素节点
    vnode.elm = vnode.componentInstance.$el
    if (isPatchable(vnode)) {
      // 调用 create 钩子
      invokeCreateHooks(vnode, insertedVnodeQueue)
      setScope(vnode)
    } else {
      // empty component root.
      // skip all element-related modules except for ref (#3455)
      registerRef(vnode)
      // make sure to invoke the insert hook
      insertedVnodeQueue.push(vnode)
    }
  }

  function reactivateComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
    let i
    // hack for #4339: a reactivated component with inner transition
    // does not trigger because the inner node's created hooks are not called
    // again. It's not ideal to involve module-specific logic in here but
    // there doesn't seem to be a better way to do it.
    let innerNode = vnode
    while (innerNode.componentInstance) {
      innerNode = innerNode.componentInstance._vnode
      if (isDef(i = innerNode.data) && isDef(i = i.transition)) {
        for (i = 0; i < cbs.activate.length; ++i) {
          cbs.activate[i](emptyNode, innerNode)
        }
        insertedVnodeQueue.push(innerNode)
        break
      }
    }
    // unlike a newly created component,
    // a reactivated keep-alive component doesn't insert itself
    insert(parentElm, vnode.elm, refElm)
  }

  /**
   * 将节点插入到父元素节点之下
   */
  function insert (parent, elm, ref) {
    if (isDef(parent)) {
      if (isDef(ref)) {
        if (nodeOps.parentNode(ref) === parent) {
          nodeOps.insertBefore(parent, elm, ref)
        }
      } else {
        nodeOps.appendChild(parent, elm)
      }
    }
  }

  /**
   * 创建子 DOM 节点
   * @param {*} vnode 虚拟节点
   * @param {*} children vnode.children，即虚拟节点的子虚拟节点
   * @param {*} insertedVnodeQueue
   */
  function createChildren (vnode, children, insertedVnodeQueue) {
    if (Array.isArray(children)) {
      if (process.env.NODE_ENV !== 'production') {
        // 子 VNode 去重
        checkDuplicateKeys(children)
      }
      for (let i = 0; i < children.length; ++i) {
        createElm(children[i], insertedVnodeQueue, vnode.elm, null, true, children, i)
      }
    } else if (isPrimitive(vnode.text)) {
      // 若 VNode 是仅包含文本的节点
      nodeOps.appendChild(vnode.elm, nodeOps.createTextNode(String(vnode.text)))
    }
  }

  /**
   * 判断 vnode 是否是可 patch 的：若组件的根 DOM 元素节点，则返回 true
   */
  function isPatchable (vnode) {
    while (vnode.componentInstance) {
      vnode = vnode.componentInstance._vnode
    }
    // 经过 while 循环后，vnode 是一开始传入的 vnode 的首个非组件节点对应的 vnode
    return isDef(vnode.tag)
  }

  /**
   * DOM 元素节点创建好后，或初始化组件时，添加其 ref、directives、class、style 等等
   */
  function invokeCreateHooks (vnode, insertedVnodeQueue) {
    for (let i = 0; i < cbs.create.length; ++i) {
      // 调用元素的 create 钩子，包括
      // - 注册 ref
      // - 注册 directives
      // - 添加 class 特性
      // - 添加 style 属性
      // - 添加其他 attrs 特性
      // - 添加原生事件处理
      // - 添加 dom-props，如 textContent/innerHTML/value 等
      // - （待补充）
      cbs.create[i](emptyNode, vnode)
    }
    i = vnode.data.hook // Reuse variable
    if (isDef(i)) {
      if (isDef(i.create)) i.create(emptyNode, vnode)
      if (isDef(i.insert)) insertedVnodeQueue.push(vnode)
    }
  }

  // set scope id attribute for scoped CSS.
  // this is implemented as a special case to avoid the overhead
  // of going through the normal attribute patching process.
  function setScope (vnode) {
    let i
    if (isDef(i = vnode.fnScopeId)) {
      nodeOps.setStyleScope(vnode.elm, i)
    } else {
      let ancestor = vnode
      while (ancestor) {
        if (isDef(i = ancestor.context) && isDef(i = i.$options._scopeId)) {
          nodeOps.setStyleScope(vnode.elm, i)
        }
        ancestor = ancestor.parent
      }
    }
    // for slot content they should also get the scopeId from the host instance.
    if (isDef(i = activeInstance) &&
      i !== vnode.context &&
      i !== vnode.fnContext &&
      isDef(i = i.$options._scopeId)
    ) {
      nodeOps.setStyleScope(vnode.elm, i)
    }
  }

  /**
   * 为 DOM 元素节点添加一系列子节点
   */
  function addVnodes (parentElm, refElm, vnodes, startIdx, endIdx, insertedVnodeQueue) {
    for (; startIdx <= endIdx; ++startIdx) {
      createElm(vnodes[startIdx], insertedVnodeQueue, parentElm, refElm, false, vnodes, startIdx)
    }
  }

  /**
   * （递归地）销毁 VNode 节点及其子节点
   */
  function invokeDestroyHook (vnode) {
    let i, j
    const data = vnode.data
    if (isDef(data)) {
      // 组件占位 VNode 的 destroy 钩子
      if (isDef(i = data.hook) && isDef(i = i.destroy)) i(vnode)
      // 各个模块的 detroy 钩子
      for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode)
    }
    if (isDef(i = vnode.children)) {
      for (j = 0; j < vnode.children.length; ++j) {
        invokeDestroyHook(vnode.children[j])
      }
    }
  }

  /**
   * 移除子 VNode 及其 DOM 元素节点
   * @param {Element} parentElm 父 DOM 元素节点
   * @param {Vnode} vnodes 要移除的子 vnode 数组
   * @param {Number} startIdx 要移除的开始索引（包含）
   * @param {Number} endIdx 要移除的结束索引（包含）
   */
  function removeVnodes (parentElm, vnodes, startIdx, endIdx) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx]
      if (isDef(ch)) {
        if (isDef(ch.tag)) {
          // （递归地）移除 VNode 对应的 DOM 元素节点
          removeAndInvokeRemoveHook(ch)
          // （递归地）销毁 VNode 节点及其子节点
          invokeDestroyHook(ch)
        } else { // Text node
          // vnode 没有 tag 属性，即为文本节点，则删除文本节点
          removeNode(ch.elm)
        }
      }
    }
  }

  /**
   * （递归地）移除 VNode 对应的 DOM 元素节点
   * @param {Vnode} vnode Vnode 节点
   * @param {Function} rm 回调函数，在其中删除 DOM 元素节点
   */
  function removeAndInvokeRemoveHook (vnode, rm) {
    if (isDef(rm) || isDef(vnode.data)) {
      let i
      // 加一是因为除了要调用 cbs.remove 上的所有函数，还要执行 vnode.data.hook.remove 函数
      const listeners = cbs.remove.length + 1
      if (isDef(rm)) {
        // we have a recursively passed down rm callback
        // increase the listeners count
        rm.listeners += listeners
      } else {
        // directly removing
        rm = createRmCb(vnode.elm, listeners)
      }
      // recursively invoke hooks on child component root node
      if (isDef(i = vnode.componentInstance) && isDef(i = i._vnode) && isDef(i.data)) {
        removeAndInvokeRemoveHook(i, rm)
      }
      for (i = 0; i < cbs.remove.length; ++i) {
        cbs.remove[i](vnode, rm)
      }
      if (isDef(i = vnode.data.hook) && isDef(i = i.remove)) {
        i(vnode, rm)
      } else {
        rm()
      }
    } else {
      removeNode(vnode.elm)
    }
  }

  /**
   * 更新 VNode 的子 VNode
   * @param {*} parentElm VNode 对应的 DOM 元素节点
   * @param {*} oldCh 旧 VNode 的子 VNode 数组
   * @param {*} newCh 新 VNode 的子 VNode 数组
   * @param {*} insertedVnodeQueue
   * @param {*} removeOnly
   */
  function updateChildren (parentElm, oldCh, newCh, insertedVnodeQueue, removeOnly) {
    let oldStartIdx = 0
    let newStartIdx = 0
    let oldEndIdx = oldCh.length - 1
    // 下一个未经 patch 的旧子 VNode 节点，在此索引之前的旧子 VNode 都已经处理完毕
    let oldStartVnode = oldCh[0]
    // 最后一个未经 patch 的旧子 VNode 节点，在此索引之后的旧子 VNode 都已经处理完毕
    let oldEndVnode = oldCh[oldEndIdx]
    let newEndIdx = newCh.length - 1
    // 下一个未经 patch 的新子 VNode 节点，在此索引之前的新子 VNode 都已经处理完毕
    let newStartVnode = newCh[0]
    // 最后一个未经 patch 的新子 VNode 节点，在此索引之后的新子 VNode 都已经处理完毕
    let newEndVnode = newCh[newEndIdx]
    let oldKeyToIdx, idxInOld, vnodeToMove, refElm

    // removeOnly is a special flag used only by <transition-group>
    // to ensure removed elements stay in correct relative positions
    // during leaving transitions
    const canMove = !removeOnly

    if (process.env.NODE_ENV !== 'production') {
      checkDuplicateKeys(newCh)
    }

    // 为了在单次循环里尽可能多地比较新旧子 VNode 是否是`sameVnode`，且不添加新的循环而引入更大的复杂度，每次循环里会进行四次比较：
    // - oldStartVnode vs newStartVnode
    // - oldEndVnode vs newEndVnode
    // - oldStartVnode vs newEndVnode
    // - oldEndVnode vs newStartVnode
    // 其中，前两种出现的概率最大，而两种是为了尽量多地比较但又不引入新的循环的情况下进行比较的。
    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      // 这里要针对 oldStartVnode 和 oldEndVnode 判断是否为 undefined，是因为最后一个 else 里的逻辑可能会将旧子 VNode 设置为 undefined
      if (isUndef(oldStartVnode)) {
        oldStartVnode = oldCh[++oldStartIdx] // Vnode has been moved left
      } else if (isUndef(oldEndVnode)) {
        oldEndVnode = oldCh[--oldEndIdx]
      } else if (sameVnode(oldStartVnode, newStartVnode)) {
        // PS：oldStartVnode 和 newStartVnode，最有可能是同一个 VNode
        patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue)
        oldStartVnode = oldCh[++oldStartIdx]
        newStartVnode = newCh[++newStartIdx]
      } else if (sameVnode(oldEndVnode, newEndVnode)) {
        // PS：oldEndVnode 和 newEndVnode，最有可能是同一个 VNode
        patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue)
        oldEndVnode = oldCh[--oldEndIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldStartVnode, newEndVnode)) { // Vnode moved right
        // PS：oldStartVnode 和 newEndVnode，也有可能是同一个 VNode
        patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue)
        // patch 后将 oldStartVnode 对应的 DOM 节点移到 oldEndVnode 对应的 DOM 节点之后
        canMove && nodeOps.insertBefore(parentElm, oldStartVnode.elm, nodeOps.nextSibling(oldEndVnode.elm))
        oldStartVnode = oldCh[++oldStartIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldEndVnode, newStartVnode)) { // Vnode moved left
        // PS：oldEndVnode 和 newStartVnode，也有可能是同一个 VNode
        patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue)
        // patch 后将 oldEndVnode 对应的 DOM 节点移到 oldStartVnode 对应的 DOM 节点之前
        canMove && nodeOps.insertBefore(parentElm, oldEndVnode.elm, oldStartVnode.elm)
        oldEndVnode = oldCh[--oldEndIdx]
        newStartVnode = newCh[++newStartIdx]
      } else {
        // 查找 newStartVnode 在 oldChildren 里对应的 oldVnode 的索引
        // 注意：oldStartIdx 之前和 oldEndIdx 之后的 VNode 都已经处理完毕
        if (isUndef(oldKeyToIdx)) oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx)
        idxInOld = isDef(newStartVnode.key)
          ? oldKeyToIdx[newStartVnode.key]
          : findIdxInOld(newStartVnode, oldCh, oldStartIdx, oldEndIdx)
        if (isUndef(idxInOld)) { // New element
          // 若是没找到对应的 oldVnode，创建新的元素
          createElm(newStartVnode, insertedVnodeQueue, parentElm, oldStartVnode.elm, false, newCh, newStartIdx)
        } else {
          // 若是找到对应的 oldVnode
          vnodeToMove = oldCh[idxInOld]
          if (sameVnode(vnodeToMove, newStartVnode)) {
            // 移动
            patchVnode(vnodeToMove, newStartVnode, insertedVnodeQueue)
            oldCh[idxInOld] = undefined
            canMove && nodeOps.insertBefore(parentElm, vnodeToMove.elm, oldStartVnode.elm)
          } else {
            // same key but different element. treat as new element
            createElm(newStartVnode, insertedVnodeQueue, parentElm, oldStartVnode.elm, false, newCh, newStartIdx)
          }
        }
        newStartVnode = newCh[++newStartIdx]
      }
    }
    if (oldStartIdx > oldEndIdx) {
      // oldChildren 先遍历完，说明 newChildren 存在多余节点，添加这些新节点
      refElm = isUndef(newCh[newEndIdx + 1]) ? null : newCh[newEndIdx + 1].elm
      addVnodes(parentElm, refElm, newCh, newStartIdx, newEndIdx, insertedVnodeQueue)
    } else if (newStartIdx > newEndIdx) {
      // newChildren 先遍历完，说明 oldChildren 存在多余节点，删除掉
      removeVnodes(parentElm, oldCh, oldStartIdx, oldEndIdx)
    }
  }

  /**
   * 根据 VNode 的 key，去除重复的子 VNode
   * @param {*} children 子 VNode 数组
   */
  function checkDuplicateKeys (children) {
    const seenKeys = {}
    for (let i = 0; i < children.length; i++) {
      const vnode = children[i]
      const key = vnode.key
      if (isDef(key)) {
        if (seenKeys[key]) {
          warn(
            `Duplicate keys detected: '${key}'. This may cause an update error.`,
            vnode.context
          )
        } else {
          seenKeys[key] = true
        }
      }
    }
  }


  /**
   * 在旧 children 的 oldStartIdx 和 oldEndIdx 区间内，查找是否存在与 newStartVnode 是 sameVnode 的子 VNode 的索引
   */
  function findIdxInOld (node, oldCh, start, end) {
    for (let i = start; i < end; i++) {
      const c = oldCh[i]
      if (isDef(c) && sameVnode(node, c)) return i
    }
  }

  /**
   * 修补 VNode
   */
  function patchVnode (oldVnode, vnode, insertedVnodeQueue, removeOnly) {
    if (oldVnode === vnode) {
      // TODO: 这是什么情况下出现的，不都是新建的 VNode 吗？
      return
    }

    const elm = vnode.elm = oldVnode.elm

    // 若旧 VNode 是异步占位 VNode
    if (isTrue(oldVnode.isAsyncPlaceholder)) {
      if (isDef(vnode.asyncFactory.resolved)) {
        // 新 VNode 是异步组件成功解析之后 render 出的 VNode，则进行混合操作
        hydrate(oldVnode.elm, vnode, insertedVnodeQueue)
      } else {
        // TODO: isAsyncPlaceholder 默认是 false，怎么进入满足 isTrue(oldVnode.isAsyncPlaceholder) ？
        vnode.isAsyncPlaceholder = true
      }
      return
    }

    // reuse element for static trees.
    // note we only do this if the vnode is cloned -
    // if the new node is not cloned it means the render functions have been
    // reset by the hot-reload-api and we need to do a proper re-render.
    // TODO:
    if (isTrue(vnode.isStatic) &&
      isTrue(oldVnode.isStatic) &&
      vnode.key === oldVnode.key &&
      (isTrue(vnode.isCloned) || isTrue(vnode.isOnce))
    ) {
      vnode.componentInstance = oldVnode.componentInstance
      return
    }

    let i
    const data = vnode.data
    if (isDef(data) && isDef(i = data.hook) && isDef(i = i.prepatch)) {
      // 调用组件占位 VNode 的 prepatch 钩子
      i(oldVnode, vnode)
    }

    const oldCh = oldVnode.children
    const ch = vnode.children
    if (isDef(data) && isPatchable(vnode)) {
      // 调用各个模块的 update 钩子
      for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode)
      // 调用（带有自定义指令且指令存在 update 钩子的元素类型的） VNode 的 update 钩子
      if (isDef(i = data.hook) && isDef(i = i.update)) i(oldVnode, vnode)
    }
    if (isUndef(vnode.text)) {
      // 若 VNode 不是文本节点，即是元素类型的 VNode 或组件占位 VNode
      if (isDef(oldCh) && isDef(ch)) {
        // 若 vnode 和 oldVnode 的 children 都存在
        if (oldCh !== ch) updateChildren(elm, oldCh, ch, insertedVnodeQueue, removeOnly)
      } else if (isDef(ch)) {
        // 若 vnode 的 children 存在但 oldVnode 的 children 不存在，则添加子节点
        if (isDef(oldVnode.text)) nodeOps.setTextContent(elm, '')
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue)
      } else if (isDef(oldCh)) {
        // 若 oldVnode.children 存在但 vnode.children 不存在，则删除 oldVnode.children
        removeVnodes(elm, oldCh, 0, oldCh.length - 1)
      } else if (isDef(oldVnode.text)) {
        // 若 oldVnode 是文本类型的 VNode，则删除文本内容
        nodeOps.setTextContent(elm, '')
      }
    } else if (oldVnode.text !== vnode.text) {
      // 文本/注释类型的 VNode，设置 DOM 节点的 textContent（DOM 注释节点也能通过 textContent 设置注释的内容哦）
      nodeOps.setTextContent(elm, vnode.text)
    }
    if (isDef(data)) {
      // 调用（带有自定义指令且指令存在 componentUpdated 钩子的元素类型的） VNode 的 postpatch 钩子
      if (isDef(i = data.hook) && isDef(i = i.postpatch)) i(oldVnode, vnode)
    }
  }

  /**
   * 调用 insert 钩子函数（如果是组件节点，则调用组件的 mounted 钩子）
   * @param {*} vnode 虚拟节点
   * @param {*} queue 待调用 insert 钩子函数的 VNode 数组，这些 VNode 都有 insert 钩子
   * @param {*} initial 是否是子组件的首次渲染
   */
  function invokeInsertHook (vnode, queue, initial) {
    // delay insert hooks for component root nodes, invoke them after the
    // element is really inserted
    if (isTrue(initial) && isDef(vnode.parent)) {
      // 此处的 vnode 是子组件实例的渲染 VNode，vnode.parent 是子组件实例的占位 VNode

      // 若是子组件的首次渲染，则不先调用 queue 里的各个 VNode 的 insert 钩子
      // 而是将 queue 赋给子组件占位 VNode 的`vnode.data.pendingInsert`
      // 等到子组件实例初始化时，再做处理
      vnode.parent.data.pendingInsert = queue
    } else {
      for (let i = 0; i < queue.length; ++i) {
        queue[i].data.hook.insert(queue[i])
      }
    }
  }

  let hydrationBailed = false
  // list of modules that can skip create hook during hydration because they
  // are already rendered on the client or has no need for initialization
  // Note: style is excluded because it relies on initial clone for future
  // deep updates (#7063).
  const isRenderedModule = makeMap('attrs,class,staticClass,staticStyle,key')

  // Note: this is a browser-only function so we can assume elms are DOM nodes.
  /**
   * 涉及到 SSR，可跳过
   */
  function hydrate (elm, vnode, insertedVnodeQueue, inVPre) {
    let i
    const { tag, data, children } = vnode
    inVPre = inVPre || (data && data.pre)
    vnode.elm = elm

    if (isTrue(vnode.isComment) && isDef(vnode.asyncFactory)) {
      vnode.isAsyncPlaceholder = true
      return true
    }
    // assert node match
    if (process.env.NODE_ENV !== 'production') {
      if (!assertNodeMatch(elm, vnode, inVPre)) {
        return false
      }
    }
    if (isDef(data)) {
      if (isDef(i = data.hook) && isDef(i = i.init)) i(vnode, true /* hydrating */)
      if (isDef(i = vnode.componentInstance)) {
        // child component. it should have hydrated its own tree.
        initComponent(vnode, insertedVnodeQueue)
        return true
      }
    }
    if (isDef(tag)) {
      if (isDef(children)) {
        // empty element, allow client to pick up and populate children
        if (!elm.hasChildNodes()) {
          createChildren(vnode, children, insertedVnodeQueue)
        } else {
          // v-html and domProps: innerHTML
          if (isDef(i = data) && isDef(i = i.domProps) && isDef(i = i.innerHTML)) {
            if (i !== elm.innerHTML) {
              /* istanbul ignore if */
              if (process.env.NODE_ENV !== 'production' &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn('server innerHTML: ', i)
                console.warn('client innerHTML: ', elm.innerHTML)
              }
              return false
            }
          } else {
            // iterate and compare children lists
            let childrenMatch = true
            let childNode = elm.firstChild
            for (let i = 0; i < children.length; i++) {
              if (!childNode || !hydrate(childNode, children[i], insertedVnodeQueue, inVPre)) {
                childrenMatch = false
                break
              }
              childNode = childNode.nextSibling
            }
            // if childNode is not null, it means the actual childNodes list is
            // longer than the virtual children list.
            if (!childrenMatch || childNode) {
              /* istanbul ignore if */
              if (process.env.NODE_ENV !== 'production' &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn('Mismatching childNodes vs. VNodes: ', elm.childNodes, children)
              }
              return false
            }
          }
        }
      }
      if (isDef(data)) {
        let fullInvoke = false
        for (const key in data) {
          if (!isRenderedModule(key)) {
            fullInvoke = true
            invokeCreateHooks(vnode, insertedVnodeQueue)
            break
          }
        }
        if (!fullInvoke && data['class']) {
          // ensure collecting deps for deep class bindings for future updates
          traverse(data['class'])
        }
      }
    } else if (elm.data !== vnode.text) {
      elm.data = vnode.text
    }
    return true
  }

  function assertNodeMatch (node, vnode, inVPre) {
    if (isDef(vnode.tag)) {
      return vnode.tag.indexOf('vue-component') === 0 || (
        !isUnknownElement(vnode, inVPre) &&
        vnode.tag.toLowerCase() === (node.tagName && node.tagName.toLowerCase())
      )
    } else {
      return node.nodeType === (vnode.isComment ? 8 : 3)
    }
  }

  /**
   * 执行`patch`函数，是为组件的渲染 VNode 创建 DOM Tree，最后插入到文档内。在此过程中，会新增 DOM 节点、修补（patch）DOM 节点、删除 DOM 节点。

   * - 组件创建时，会首次调用`patch`，会根据渲染 VNode 创建 DOM Tree，DOM Tree 里所有 DOM 元素/子组件实例都是新创建的，且 DOM Tree 是递归生成的。
   * - 组件改变时，每次都会调用`patch`，会根据改变前后的渲染 VNode 修补 DOM Tree，该过程可能会新增 DOM 节点、修补（patch）DOM 节点、删除 DOM 节点。
   * - 组件销毁时，最后一次调用`patch`，会销毁 DOM Tree。
   *
   * @param {*} oldVnode 组件旧的渲染 VNode
   * @param {*} vnode 组件新的渲染 VNode（执行 vm._render 后返回的）
   * @param {*} hydrating 是否混合（服务端渲染时为 true，非服务端渲染情况下为 false）
   * @param {*} removeOnly 这个参数是给 transition-group 用的
   *
   * 需要额外注意的是，这里的传入的 vnode 肯定是某组件的渲染 VNode；而对于连续嵌套组件的情况来说，渲染 VNode 同时也是直接子组件的占位 VNode
   */
  return function patch (oldVnode, vnode, hydrating, removeOnly) {
    if (isUndef(vnode)) {
      // 销毁 vnode 节点
      // 组件调用 Vue.prototype.$destroy 时，会调用 vm.__patch__(vm._vnode, null) 销毁 vnode 节点
      if (isDef(oldVnode)) invokeDestroyHook(oldVnode)
      return
    }

    let isInitialPatch = false

    // 组件的渲染 VNode 生成 DOM Tree 过程中，收集一些 VNode，这些 VNode 都存在 vnode.data.hook.insert 方法，即 VNode 对应的 DOM 元素节点在插入到文档里后需要做一些处理工作。
    // 这些 VNode 大致分为两类：
    // 一类是元素类型的 VNode，且自定义指令有 inserted 钩子，在 DOM 元素节点插入到父元素时执行一些操作
    // 一类是组件占位 VNode，在组件插入到父元素上时，也要做一些操作，比如调用 mounted 钩子等
    const insertedVnodeQueue = []

    if (isUndef(oldVnode)) {
      // empty mount (likely as component), create new root element

      // 生成子组件的 DOM Tree（子组件实例首次 patch，oldVnode 为 undefined）
      // 子组件的首次渲染
      isInitialPatch = true
      createElm(vnode, insertedVnodeQueue)
    } else {
      // 根组件实例首次 patch，oldVnode 为要挂载到的 DOM 元素节点
      const isRealElement = isDef(oldVnode.nodeType)
      if (!isRealElement && sameVnode(oldVnode, vnode)) {
        // patch existing root node
        // （根组件/子组件）新旧 VNode Tree 进行 patch 时
        patchVnode(oldVnode, vnode, insertedVnodeQueue, removeOnly)
      } else {
        // 根组件实例首次 patch || （根组件/子组件）新旧 vnode 不是同一 vnode
        if (isRealElement) {
          // 根组件实例首次 patch

          // mounting to a real element
          // check if this is server-rendered content and if we can perform
          // a successful hydration.
          if (oldVnode.nodeType === 1 && oldVnode.hasAttribute(SSR_ATTR)) {
            // 若是元素上有特性 data-server-rendered，表明是服务端渲染，删除该特性，将 hydrating 置为 true
            oldVnode.removeAttribute(SSR_ATTR)
            hydrating = true
          }
          // 服务端渲染相关
          if (isTrue(hydrating)) {
            if (hydrate(oldVnode, vnode, insertedVnodeQueue)) {
              invokeInsertHook(vnode, insertedVnodeQueue, true)
              return oldVnode
            } else if (process.env.NODE_ENV !== 'production') {
              warn(
                'The client-side rendered virtual DOM tree is not matching ' +
                'server-rendered content. This is likely caused by incorrect ' +
                'HTML markup, for example nesting block-level elements inside ' +
                '<p>, or missing <tbody>. Bailing hydration and performing ' +
                'full client-side render.'
              )
            }
          }
          // either not server-rendered, or hydration failed.
          // create an empty node and replace it

          // 若是根实例首次 patch，将 el 处理出 oldVnode 的形式，再统一处理
          // （则创建空的 vnode 节点，tag 为 DOM 元素节点的标签名，elm 为该 DOM 元素节点）
          oldVnode = emptyNodeAt(oldVnode)
        }

        // replacing existing element
        const oldElm = oldVnode.elm
        // 组件占位 VNode 的 DOM 父元素节点
        const parentElm = nodeOps.parentNode(oldElm)

        // create new node
        // 为新的 VNode 创建元素/组件实例，若 parentElm 存在，则插入到父元素上
        createElm(
          vnode,
          insertedVnodeQueue,
          // extremely rare edge case: do not insert if old element is in a
          // leaving transition. Only happens when combining transition +
          // keep-alive + HOCs. (#4590)
          // 父元素
          oldElm._leaveCb ? null : parentElm,
          // 后一兄弟元素，新元素将挂载在父元素之下，后一兄弟元素之前
          nodeOps.nextSibling(oldElm)
        )

        // update parent placeholder node element, recursively
        // (以下逻辑仅针对子组件修补 DOM Tree 的情况)
        // 处理“连续嵌套组件”的情况，即父组件的渲染 VNode 同时是子组件的占位 VNode
        // 详见 https://windstone.cc/vue/source-study/topics/dom-binding.html#组件占位-vnode
        if (isDef(vnode.parent)) {
          // vnode 是组件子实例调用 _render() 生成的 VNode
          // vnode.parent 是在子组件实例调用 _render() 的最后添加的，vnode.parent 指向子组件占位 VNode
          let ancestor = vnode.parent
          const patchable = isPatchable(vnode)
          while (ancestor) {
            // 针对连续嵌套组件里的父组件占位 VNode 调用各模块的 destroy 钩子
            for (let i = 0; i < cbs.destroy.length; ++i) {
              cbs.destroy[i](ancestor)
            }
            // 递归更新父组件占位 VNode 的 elm
            ancestor.elm = vnode.elm
            if (patchable) {
              // 针对连续嵌套组件里的父组件占位 VNode 调用各模块的 create 钩子
              for (let i = 0; i < cbs.create.length; ++i) {
                cbs.create[i](emptyNode, ancestor)
              }
              // #6513
              // invoke insert hooks that may have been merged by create hooks.
              // e.g. for directives that uses the "inserted" hook.
              const insert = ancestor.data.hook.insert
              if (insert.merged) {
                // start at index 1 to avoid re-invoking component mounted hook
                for (let i = 1; i < insert.fns.length; i++) {
                  insert.fns[i]()
                }
              }
            } else {
              // 针对连续嵌套组件里的父组件占位 VNode，注册 ref
              registerRef(ancestor)
            }
            ancestor = ancestor.parent
          }
        }

        // destroy old node
        if (isDef(parentElm)) {
          // parentElm 存在，说明该旧 VNode 对应的 DOM 元素节点存在在 document 上
          // 不仅需要销毁旧的 VNode，还要移除旧的 DOM 元素节点
          removeVnodes(parentElm, [oldVnode], 0, 0)
        } else if (isDef(oldVnode.tag)) {
          // parentElm 不存在，仅销毁旧的 VNode
          invokeDestroyHook(oldVnode)
        }
      }
    }

    // 针对所有新创建的节点，调用 insert 钩子函数
    // isInitialPatch 为 true 时，表示子组件的首次渲染
    invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch)

    // 返回组件渲染 VNode 的 vnode.elm
    return vnode.elm
  }
}
