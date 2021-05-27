/* @flow */

import { parse } from './parser/index'
import { optimize } from './optimizer'
import { generate } from './codegen/index'
import { createCompilerCreator } from './create-compiler'

// `createCompilerCreator` allows creating compilers that use alternative
// parser/optimizer/codegen, e.g the SSR optimizing compiler.
// Here we just export a default compiler using the default parts.
export const createCompiler = createCompilerCreator(function baseCompile (
  template: string,
  options: CompilerOptions
): CompiledResult {
  // 解析模板字符串，创建 AST
  const ast = parse(template.trim(), options)

  // 标记 AST Tree 里可优化的节点
  if (options.optimize !== false) {
    optimize(ast, options)
  }

  // 基于 AST 生成字符串形式的`render`/`staticRenderFns`
  const code = generate(ast, options)
  return {
    ast,
    // 字符串形式的 render/staticRenderFns
    render: code.render,
    staticRenderFns: code.staticRenderFns
  }
})
