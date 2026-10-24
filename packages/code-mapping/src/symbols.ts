import type { SymbolKind } from '@codementor/contracts';

/** 单个源码符号的解析结果（1 基行号，含起止行）。 */
export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
}

export interface ParseResult {
  /** 语法树是否包含错误节点；为 true 时行级位置不可信，只能降级处理。 */
  hasErrors: boolean;
  symbols: SymbolInfo[];
}

/**
 * 语言解析器抽象：阶段 3 提供 C 实现，TypeScript 等后续语言
 * 通过实现本接口注册进 ParserRegistry，映射引擎其余部分不感知具体语言。
 */
export interface SourceParser {
  languageId: string;
  /** 支持的文件扩展名（小写、含点）。 */
  extensions: readonly string[];
  parse(source: string): ParseResult;
}

export class ParserRegistry {
  private readonly parsers = new Map<string, SourceParser>();

  register(parser: SourceParser): void {
    this.parsers.set(parser.languageId, parser);
  }

  byLanguageId(languageId: string): SourceParser | undefined {
    return this.parsers.get(languageId);
  }

  /** 按文件扩展名选择解析器；未注册的扩展名返回 undefined（调用方决定如何降级）。 */
  byFilePath(filePath: string): SourceParser | undefined {
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) {
      return undefined;
    }
    const ext = filePath.slice(dot).toLowerCase();
    return [...this.parsers.values()].find((p) => p.extensions.includes(ext));
  }
}
