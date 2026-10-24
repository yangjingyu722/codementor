import * as vscode from 'vscode';

/**
 * 阶段 0 仅建立扩展入口的编译骨架。
 * TreeView / CodeLens / Webview 的注册在阶段 4 实现（见 docs/PROJECT_STATUS.md）。
 */
export function activate(_context: vscode.ExtensionContext): void {
  // 阶段 4：连接本地核心服务并注册视图。
}

export function deactivate(): void {}
