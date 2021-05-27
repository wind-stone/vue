/* @flow */

import { parse } from 'compiler/parser/index'
import { generate } from './codegen'
import { optimize } from './optimizer'
import { createCompilerCreator } from 'compiler/create-compiler'

export const createCompiler = createCompilerCreator(function baseCompile (
  template: string,
  options: CompilerOptions
): CompiledResult {
  // 解析模板字符串，创建 AST；这里跟 CSR 的 parse 是完全一样的
  const ast = parse(template.trim(), options)
  // 标记 AST Tree 里可优化的节点，这里跟 CSR 的 optimize 不一样
  optimize(ast, options)

  // 基于 AST 生成字符串形式的 render/staticRenderFns，这里跟 CSR 的 generate 不一样
  const code = generate(ast, options)
  return {
    ast,
    render: code.render,
    staticRenderFns: code.staticRenderFns
  }
})
