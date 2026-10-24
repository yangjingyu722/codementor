import * as vscode from 'vscode';
import fs from 'node:fs';
import type { CodeAnchor } from '@codementor/contracts';
import { ApiClient, ServiceLocator, defaultHomeDir } from './client/api-client';
import { DecisionCodeLensProvider } from './codelens/decision-codelens';
import { ProjectDataLoader } from './loader/project-data';
import { DecisionTreeProvider } from './tree/decisions-tree';
import { DecisionDetailPanel } from './webview/decision-detail';

export interface CodementorApi {
  tree: DecisionTreeProvider;
  lenses: DecisionCodeLensProvider;
  loader: ProjectDataLoader;
  client: ApiClient;
  __test: { panelsOpened: number };
}

function firstWorkspaceRoot(): string | undefined {
  const fsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (fsPath === undefined) {
    return undefined;
  }
  // VS Code 会把 URI 盘符规范化为小写；用 realpath 还原文件系统真实大小写，
  // 保证与核心服务中注册的 rootPath 精确匹配（Windows 不区分大小写但存储按字符串比较）。
  try {
    return fs.realpathSync.native(fsPath);
  } catch {
    return fsPath;
  }
}

function resolveHomeDir(): string {
  const configured = vscode.workspace.getConfiguration('codementor').get<string>('homeDir')?.trim();
  return configured !== undefined && configured.length > 0
    ? configured
    : defaultHomeDir(process.env);
}

export function activate(context: vscode.ExtensionContext): CodementorApi {
  const client = new ApiClient(new ServiceLocator(resolveHomeDir));
  const loader = new ProjectDataLoader(client, firstWorkspaceRoot);
  const tree = new DecisionTreeProvider(loader);
  const lenses = new DecisionCodeLensProvider(loader);
  const detail = new DecisionDetailPanel(client, (anchor) => revealAnchor(anchor));
  const testState = { panelsOpened: 0 };

  const refreshAll = (): void => {
    loader.invalidate();
    tree.refresh();
    lenses.refresh();
  };

  // 状态栏：只在服务不可用时出现，避免打扰
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
  statusItem.name = 'CodeMentor 服务状态';
  statusItem.text = '$(circle-slash) CodeMentor 服务未连接';
  statusItem.tooltip = '点击查看核心服务连接帮助';
  statusItem.command = 'codementor.showServiceHelp';

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('codementor.decisions', tree),
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'c', scheme: 'file' },
        { language: 'cpp', scheme: 'file' },
      ],
      lenses,
    ),
    statusItem,
    vscode.commands.registerCommand('codementor.refresh', refreshAll),
    vscode.commands.registerCommand('codementor.openDecision', async (decisionId: string) => {
      try {
        await detail.show(decisionId);
        testState.panelsOpened += 1;
      } catch (err) {
        void vscode.window.showErrorMessage(
          `无法打开决策详情：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand('codementor.revealAnchor', (anchor: CodeAnchor) =>
      revealAnchor(anchor),
    ),
    vscode.commands.registerCommand('codementor.revalidateAnchors', async () => {
      const data = await loader.get(true);
      if (data.state !== 'ready' || data.project === undefined) {
        void vscode.window.showInformationMessage(
          data.state === 'offline'
            ? '核心服务未连接，无法重新验证锚点。'
            : '当前工作区没有已注册的工程。',
        );
        return;
      }
      try {
        const result = await client.revalidateAnchors(data.project.id);
        refreshAll();
        const confirmed = result.results.filter((r) => r.status === 'confirmed').length;
        const degraded = result.results.length - confirmed;
        void vscode.window.showInformationMessage(
          `锚点重验证完成：${confirmed} 个已确认${degraded > 0 ? `，${degraded} 个已失效/不确定（见决策树状态）` : ''}。`,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `重验证失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand('codementor.showServiceHelp', () => {
      void vscode.window
        .showInformationMessage(
          'CodeMentor 核心服务未连接。启动方式：在本仓库执行 `pnpm --filter @codementor/server start`（需先 pnpm build）。' +
            '服务启动后会在数据目录写入 server.json；扩展通过 codementor.homeDir 配置定位该目录（默认 ~/.codementor 或 CODEMENTOR_HOME）。',
          '打开设置',
        )
        .then((action) => {
          if (action === '打开设置') {
            void vscode.commands.executeCommand(
              'workbench.action.openSettings',
              '@ext:codementor-dev.codementor',
            );
          }
        });
    }),
  );

  // 初始检查：离线时状态栏提示（不弹窗）
  void loader.get(true).then((data) => {
    if (data.state === 'offline') {
      statusItem.show();
    }
  });

  return { tree, lenses, loader, client, __test: testState };
}

/** 跳转到锚点指向的代码；失效关联给出明确提示（显示最后已知位置）。 */
async function revealAnchor(anchor: CodeAnchor): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    return;
  }
  if (anchor.status === 'missing') {
    void vscode.window.showWarningMessage(
      '该设计关联已失效：符号在当前代码中已不存在。将显示最后已知位置，仅供追溯。',
    );
  } else if (anchor.status === 'ambiguous') {
    void vscode.window.showWarningMessage(
      '该设计关联无法精确定位（同名符号或代码不可解析）。将显示最后已知位置，仅供参考。',
    );
  }

  const uri = vscode.Uri.joinPath(folder.uri, ...anchor.filePath.split('/'));
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    const lastLine = Math.min(anchor.endLine - 1, document.lineCount - 1);
    const range = new vscode.Range(anchor.startLine - 1, 0, lastLine, 0);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `无法打开 ${anchor.filePath}：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function deactivate(): void {}
