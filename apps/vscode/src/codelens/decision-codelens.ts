import * as vscode from 'vscode';
import type { CodeAnchor, Decision } from '@codementor/contracts';
import type { ProjectDataLoader } from '../loader/project-data';

const STATUS_ZH: Record<CodeAnchor['status'], string> = {
  confirmed: '已确认',
  ambiguous: '定位不确定',
  missing: '已失效',
};

interface DecisionLens {
  range: vscode.Range;
  decision?: Decision;
  anchor: CodeAnchor;
}

/**
 * CodeLens：在拥有设计关联的符号声明行上方显示决策入口。
 * 数据来自核心服务的项目锚点（不在扩展内重复 tree-sitter 解析——视图层不复制引擎逻辑）。
 * 服务离线时静默返回空（不打断编辑）。
 */
export class DecisionCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  constructor(private readonly loader: ProjectDataLoader) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder === undefined) {
      return [];
    }
    const data = await this.loader.get();
    if (data.state !== 'ready') {
      return [];
    }

    const relative = vscode.workspace.asRelativePath(document.uri, false);
    const relativePosix = relative.split('\\').join('/');
    const byId = new Map(data.decisions.map((d) => [d.id, d] as const));

    const lenses: DecisionLens[] = [];
    for (const anchor of data.anchors) {
      if (anchor.filePath !== relativePosix) {
        continue;
      }
      const line = Math.min(anchor.startLine - 1, document.lineCount - 1);
      lenses.push({
        range: new vscode.Range(line, 0, line, 0),
        decision: byId.get(anchor.decisionId),
        anchor,
      });
    }

    return lenses.map(
      (lens) =>
        new vscode.CodeLens(lens.range, {
          command: 'codementor.openDecision',
          title: this.title(lens.decision, lens.anchor),
          arguments: [lens.anchor.decisionId],
        }),
    );
  }

  private title(decision: Decision | undefined, anchor: CodeAnchor): string {
    const status = STATUS_ZH[anchor.status];
    if (decision === undefined) {
      return `CodeMentor 设计关联（${status}）`;
    }
    return `◆ 设计决策：${decision.title}（${status}）`;
  }
}
