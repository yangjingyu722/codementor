import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ZodTypeAny } from 'zod';
import type { CodeAnchor, Decision } from '@codementor/contracts';
import { CodeMentorStorage } from '@codementor/storage';
import { CodeMentorError } from '@codementor/decision-engine';
import { CSourceParser } from './c-parser.js';
import { GitClient, GitError } from './git-client.js';
import type { ParseResult, SymbolInfo } from './symbols.js';
import { ParserRegistry } from './symbols.js';
import { CreateAnchorInputSchema, ProposeAnchorsInputSchema } from './schemas.js';

export interface MappingServiceOptions {
  now?: () => string;
  /** 注入自定义解析器注册表（默认含 C）；测试或新语言扩展用。 */
  registry?: ParserRegistry;
}

export interface AnchorSymbolMatch {
  anchor: CodeAnchor;
  decision: Decision;
}

export interface RevalidateResultItem {
  anchorId: string;
  previousStatus: CodeAnchor['status'];
  status: CodeAnchor['status'];
  filePath: string;
  relocated: boolean;
}

export interface RevalidateResult {
  head: string;
  results: RevalidateResultItem[];
}

export interface AnchorProposal {
  filePath: string;
  symbol: SymbolInfo;
  change: 'added' | 'modified';
  /** 候选决策：自动匹配无法语义判断归属，全部列出供人工/Agent 确认。 */
  candidateDecisionIds: string[];
}

/** 符号源文本哈希：行尾统一 LF 后计算，跨平台稳定。 */
export function hashSymbolText(source: string, startLine: number, endLine: number): string {
  const lines = source.split(/\r?\n/);
  const text = lines.slice(startLine - 1, endLine).join('\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function createDefaultRegistry(): ParserRegistry {
  const registry = new ParserRegistry();
  registry.register(new CSourceParser());
  return registry;
}

/**
 * 代码映射引擎：决策 ⇄ 源码符号的锚定、重定位与失效检测。
 *
 * 认知三角（docs/CONTRACTS.md）：
 * - 符号存在 = observed 事实（tree-sitter 解析）
 * - 决策↔符号关联 = 本引擎的判断（anchor.origin 标注来源）
 * - 设计理由推断 = rationalized 主张（decision-engine），与锚定互不混淆
 *
 * 安全边界：绝不创建解析不存在的符号；绝不做跨文件猜测式回退；
 * 绝不读取文件修改时间——版本信息只来自 git commit 与服务端时钟。
 */
export class MappingService {
  private readonly now: () => string;
  private readonly registry: ParserRegistry;

  constructor(
    private readonly storage: CodeMentorStorage,
    options: MappingServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.registry = options.registry ?? createDefaultRegistry();
  }

  private parse<S extends ZodTypeAny>(schema: S, input: unknown, context: string): S['_output'] {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new CodeMentorError('VALIDATION', `invalid ${context} input`, result.error.issues);
    }
    return result.data;
  }

  private repoRootForDecision(decision: Decision): string {
    return this.storage.getProject(decision.projectId).rootPath;
  }

  /** 拒绝越出仓库根目录的路径（外部输入防护）。 */
  private absoluteFile(repoRoot: string, filePath: string): string {
    const root = path.resolve(repoRoot);
    const abs = path.resolve(root, filePath);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new CodeMentorError('VALIDATION', `filePath escapes repository root: ${filePath}`);
    }
    return abs;
  }

  private parseFile(filePath: string, content: string): ParseResult {
    const parser = this.registry.byFilePath(filePath);
    if (parser === undefined) {
      throw new CodeMentorError('VALIDATION', `no parser registered for ${filePath}`);
    }
    return parser.parse(content);
  }

  /**
   * 创建锚点：符号必须在当前工作区文件中唯一可解析，否则报错——
   * 这是"不凭空创建符号"的强制点。
   */
  async createAnchor(input: unknown): Promise<CodeAnchor> {
    const parsed = this.parse(CreateAnchorInputSchema, input, 'createAnchor');
    const decision = this.storage.getDecision(parsed.decisionId);
    const repoRoot = this.repoRootForDecision(decision);

    const abs = this.absoluteFile(repoRoot, parsed.filePath);
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      throw new CodeMentorError('NOT_FOUND', `file not found in working tree: ${parsed.filePath}`);
    }

    const { hasErrors, symbols } = this.parseFile(parsed.filePath, content);
    if (hasErrors) {
      // 语法错误时位置不可信：拒绝创建而不是给出可能错误的锚点
      throw new CodeMentorError(
        'INVALID_STATE',
        `file ${parsed.filePath} has syntax errors; fix before anchoring`,
      );
    }
    const leaf = parsed.symbolPath[parsed.symbolPath.length - 1]!;
    const candidates = symbols.filter(
      (s) => s.name === leaf && (parsed.symbolKind === undefined || s.kind === parsed.symbolKind),
    );
    if (candidates.length === 0) {
      throw new CodeMentorError(
        'NOT_FOUND',
        `symbol '${leaf}' not found in ${parsed.filePath} (${symbols.length} symbols parsed)`,
      );
    }
    if (candidates.length > 1) {
      throw new CodeMentorError(
        'INVALID_STATE',
        `symbol '${leaf}' is ambiguous in ${parsed.filePath}: ${candidates.length} candidates`,
      );
    }
    const symbol = candidates[0]!;

    const head = await this.currentHead(repoRoot);
    return this.storage.createCodeAnchor({
      decisionId: decision.id,
      filePath: parsed.filePath,
      symbolPath: parsed.symbolPath,
      symbolKind: symbol.kind,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      contentHash: hashSymbolText(content, symbol.startLine, symbol.endLine),
      commitSha: head,
      status: 'confirmed',
      origin: parsed.origin,
      anchoredAt: this.now(),
    });
  }

  listAnchors(decisionId: string): CodeAnchor[] {
    this.storage.getDecision(decisionId);
    return this.storage.listCodeAnchorsByDecision(decisionId);
  }

  /** 反向查询：文件 + 符号名 → 锚点及其决策（含失效锚点，状态由调用方解释）。 */
  findDecisionsForSymbol(filePath: string, symbolName: string): AnchorSymbolMatch[] {
    return this.storage.findAnchorsBySymbol(filePath, symbolName).map((anchor) => ({
      anchor,
      decision: this.storage.getDecision(anchor.decisionId),
    }));
  }

  /** 只读查询：项目下全部锚点（CodeLens 数据源）。 */
  listProjectAnchors(projectId: string): CodeAnchor[] {
    this.storage.getProject(projectId);
    return this.storage.listCodeAnchorsByProject(projectId);
  }

  /**
   * 重验证项目全部锚点：符号优先重定位。
   * 文件消失先查 git 重命名；无法唯一定位 → ambiguous；符号不存在 → missing。
   * 只更新状态与位置，绝不删除锚点记录。
   */
  async revalidateProject(projectId: string): Promise<RevalidateResult> {
    const project = this.storage.getProject(projectId);
    const repoRoot = project.rootPath;
    const git = new GitClient(repoRoot);
    const head = await this.currentHead(repoRoot);
    const anchors = this.storage.listCodeAnchorsByProject(projectId);

    const results: RevalidateResultItem[] = [];
    for (const anchor of anchors) {
      const patch = await this.relocate(anchor, git, head, repoRoot);
      const updated = this.storage.updateCodeAnchor(anchor.id, patch);
      results.push({
        anchorId: anchor.id,
        previousStatus: anchor.status,
        status: updated.status,
        filePath: updated.filePath,
        relocated:
          updated.status === 'confirmed' &&
          (updated.startLine !== anchor.startLine ||
            updated.endLine !== anchor.endLine ||
            updated.filePath !== anchor.filePath ||
            updated.commitSha !== anchor.commitSha),
      });
    }
    return { head, results };
  }

  private async relocate(
    anchor: CodeAnchor,
    git: GitClient,
    head: string,
    repoRoot: string,
  ): Promise<Partial<CodeAnchor>> {
    let filePath = anchor.filePath;
    let content = this.readIfExists(this.absoluteFile(repoRoot, filePath));

    if (content === undefined) {
      // 文件不在工作区：尝试用 git 重命名检测跟随（commit 区间 = 锚定提交 → 当前 HEAD）
      try {
        const renames = (await git.changedFiles(anchor.commitSha, head)).filter(
          (c) => c.status === 'renamed' && c.oldPath === anchor.filePath,
        );
        const rename = renames[0];
        if (rename !== undefined) {
          filePath = rename.newPath;
          content = this.readIfExists(this.absoluteFile(repoRoot, filePath));
        }
      } catch {
        // 区间查询失败（如锚定提交已被 gc）：按文件缺失处理，不做猜测
      }
    }

    if (content === undefined) {
      return { status: 'missing' };
    }

    const parser = this.registry.byFilePath(filePath);
    if (parser === undefined) {
      return { filePath, status: 'ambiguous' };
    }
    const { hasErrors, symbols } = parser.parse(content);
    if (hasErrors) {
      // 语法错误时行级位置不可信：标 ambiguous 而不是给出可能错误的位置
      return { status: 'ambiguous' };
    }

    const leaf = anchor.symbolPath[anchor.symbolPath.length - 1]!;
    const candidates = symbols.filter((s) => s.name === leaf && s.kind === anchor.symbolKind);
    if (candidates.length === 0) {
      return { status: 'missing' };
    }
    if (candidates.length > 1) {
      return { status: 'ambiguous' };
    }
    const symbol = candidates[0]!;
    return {
      filePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      contentHash: hashSymbolText(content, symbol.startLine, symbol.endLine),
      commitSha: head,
      status: 'confirmed',
    };
  }

  private readIfExists(absPath: string): string | undefined {
    try {
      return fs.readFileSync(absPath, 'utf8');
    } catch {
      return undefined;
    }
  }

  private async currentHead(repoRoot: string): Promise<string> {
    try {
      return await new GitClient(repoRoot).head();
    } catch (err) {
      if (err instanceof GitError) {
        throw new CodeMentorError(
          'INVALID_STATE',
          `cannot resolve git HEAD under ${repoRoot}: ${err.message}`,
        );
      }
      throw err;
    }
  }

  /**
   * 变更区间内的新增/变更符号 → 锚点提案。
   * 只产生提案、绝不落库：自动匹配是"关联判断"的候选而非事实，
   * 由 Agent（declared）或人工确认后再走 createAnchor。
   */
  async proposeAnchors(input: unknown): Promise<{ proposals: AnchorProposal[] }> {
    const parsed = this.parse(ProposeAnchorsInputSchema, input, 'proposeAnchors');
    const task = this.storage.getTask(parsed.taskId);
    const decisions = this.storage.listDecisionsByTask(task.id);
    const repoRoot = this.storage.getProject(task.projectId).rootPath;
    const git = new GitClient(repoRoot);

    const proposals: AnchorProposal[] = [];
    const candidateDecisionIds = decisions.map((d) => d.id);

    for (const change of await git.changedFiles(parsed.oldRev, parsed.newRev)) {
      if (change.status === 'deleted') {
        continue;
      }
      const lookupPath = change.newPath;
      const parser = this.registry.byFilePath(lookupPath);
      if (parser === undefined) {
        continue;
      }
      const newContent = await git.fileContent(parsed.newRev, lookupPath);
      const oldContent =
        change.status === 'renamed'
          ? await git.fileContent(parsed.oldRev, change.oldPath)
          : await git.fileContent(parsed.oldRev, lookupPath);
      if (newContent === undefined) {
        continue;
      }
      const newResult = parser.parse(newContent);
      const oldResult =
        oldContent === undefined
          ? { symbols: [] as SymbolInfo[], hasErrors: false }
          : parser.parse(oldContent);

      const oldByKey = new Map(
        oldResult.symbols.map((s) => [`${s.kind}:${s.name}`, s] as [string, SymbolInfo]),
      );
      for (const symbol of newResult.symbols) {
        const key = `${symbol.kind}:${symbol.name}`;
        const before = oldByKey.get(key);
        if (before === undefined) {
          proposals.push({
            filePath: lookupPath,
            symbol,
            change: 'added',
            candidateDecisionIds,
          });
        } else {
          const beforeHash = hashSymbolText(oldContent ?? '', before.startLine, before.endLine);
          const afterHash = hashSymbolText(newContent, symbol.startLine, symbol.endLine);
          if (beforeHash !== afterHash) {
            proposals.push({
              filePath: lookupPath,
              symbol,
              change: 'modified',
              candidateDecisionIds,
            });
          }
        }
      }
    }
    return { proposals };
  }
}
