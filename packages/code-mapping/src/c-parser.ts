import { createRequire } from 'node:module';
import type Parser from 'tree-sitter';
import type { Language } from 'tree-sitter';
import type { SymbolKind } from '@codementor/contracts';
import type { ParseResult, SourceParser, SymbolInfo } from './symbols.js';

/**
 * 原生 CJS/NAPI 模块必须经 Node 原生 require 加载：
 * Vitest/Vite 的 ESM 互操作会包装模块对象，破坏 NAPI Language 的原生字段。
 * 版本配对约束见 ADR-0005：tree-sitter 与语法包的 ABI 必须一致。
 */
const nodeRequire = createRequire(import.meta.url);
const TreeSitter = nodeRequire('tree-sitter') as typeof Parser;
const CLanguage = nodeRequire('tree-sitter-c') as Language;

/**
 * C 语言解析器（tree-sitter）。
 * 提取：函数定义、结构体定义（含 typedef 名）、typedef 别名。
 * 前置声明（无 body）不视为符号定义；匿名结构跳过（其 typedef 名单独提取）。
 */
export class CSourceParser implements SourceParser {
  readonly languageId = 'c';
  readonly extensions = ['.c', '.h'];

  private readonly parser: InstanceType<typeof Parser>;

  constructor() {
    this.parser = new TreeSitter();
    this.parser.setLanguage(CLanguage);
  }

  parse(source: string): ParseResult {
    const root = this.parser.parse(source).rootNode;
    const symbols: SymbolInfo[] = [];
    this.collect(root, source, symbols);
    return { hasErrors: root.hasError, symbols };
  }

  private collect(node: Parser.SyntaxNode, source: string, out: SymbolInfo[]): void {
    const symbol = this.symbolFromNode(node);
    if (symbol !== undefined) {
      out.push(symbol);
    }
    for (let i = 0; i < node.childCount; i++) {
      this.collect(node.child(i)!, source, out);
    }
  }

  private symbolFromNode(node: Parser.SyntaxNode): SymbolInfo | undefined {
    if (node.type === 'function_definition') {
      const name = this.functionName(node);
      if (name === undefined) {
        return undefined;
      }
      return this.toSymbol(node, name, 'function');
    }
    if (node.type === 'struct_specifier') {
      const nameNode = node.childForFieldName('name');
      const bodyNode = node.childForFieldName('body');
      // 只有带 body 的才是定义；前置声明/引用不是符号定义
      if (nameNode === null || bodyNode === null) {
        return undefined;
      }
      return this.toSymbol(node, nameNode.text, 'struct');
    }
    if (node.type === 'type_definition') {
      const declarator = node.childForFieldName('declarator');
      if (declarator === null || declarator.type !== 'type_identifier') {
        return undefined;
      }
      return this.toSymbol(node, declarator.text, 'typedef');
    }
    return undefined;
  }

  /** 从 declarator 子树中定位函数名：下钻 pointer/parenthesized 包裹，找 function_declarator。 */
  private functionName(functionNode: Parser.SyntaxNode): string | undefined {
    const declarator = functionNode.childForFieldName('declarator');
    if (declarator === null) {
      return undefined;
    }
    const fnDeclarator = this.findFunctionDeclarator(declarator);
    if (fnDeclarator === undefined) {
      return undefined;
    }
    const inner = fnDeclarator.childForFieldName('declarator');
    if (inner === null || (inner.type !== 'identifier' && inner.type !== 'field_identifier')) {
      return undefined;
    }
    return inner.text;
  }

  private findFunctionDeclarator(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
    if (node.type === 'function_declarator') {
      return node;
    }
    for (let i = 0; i < node.childCount; i++) {
      const found = this.findFunctionDeclarator(node.child(i)!);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  private toSymbol(
    node: Parser.SyntaxNode,
    name: string,
    kind: SymbolKind,
  ): SymbolInfo | undefined {
    if (name.length === 0) {
      return undefined;
    }
    return {
      name,
      kind,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }
}
