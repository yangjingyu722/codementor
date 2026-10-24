import * as vscode from 'vscode';
import type { CodeAnchor, Decision, Task } from '@codementor/contracts';
import type { ProjectData, ProjectDataLoader } from '../loader/project-data';

type AnyNode = InfoNode | ProjectNode | TaskNode | DecisionNode | AnchorNode;

interface InfoNode {
  kind: 'info';
  label: string;
  description: string;
  tooltip: string;
  icon: vscode.ThemeIcon;
  command?: vscode.Command;
}

interface ProjectNode {
  kind: 'project';
  project: NonNullable<ProjectData['project']>;
}

interface TaskNode {
  kind: 'task';
  task: Task;
}

interface DecisionNode {
  kind: 'decision';
  decision: Decision;
}

interface AnchorNode {
  kind: 'anchor';
  anchor: CodeAnchor;
  decisionTitle: string;
}

const TASK_STATUS: Record<Task['status'], { label: string; icon: string }> = {
  planned: { label: '计划中', icon: 'clock' },
  active: { label: '进行中', icon: 'sync' },
  completed: { label: '已完成', icon: 'check' },
  abandoned: { label: '已放弃', icon: 'circle-slash' },
};

const DECISION_STATUS: Record<Decision['status'], { label: string; icon: string; color?: string }> =
  {
    draft: { label: '草稿', icon: 'pencil' },
    declared: { label: '已声明', icon: 'circle-filled', color: 'charts.blue' },
    implemented: { label: '已实现', icon: 'tools', color: 'charts.blue' },
    verified: { label: '已验证', icon: 'pass-filled', color: 'charts.green' },
    superseded: { label: '已替代', icon: 'archive', color: 'editorWarning.foreground' },
  };

const ANCHOR_STATUS: Record<CodeAnchor['status'], { label: string; icon: string; color?: string }> =
  {
    confirmed: { label: '已确认', icon: 'check', color: 'charts.green' },
    ambiguous: { label: '无法精确定位', icon: 'warning', color: 'editorWarning.foreground' },
    missing: { label: '符号已缺失', icon: 'error', color: 'errorForeground' },
  };

function themeIcon(name: string, color?: string): vscode.ThemeIcon {
  return color === undefined
    ? new vscode.ThemeIcon(name)
    : new vscode.ThemeIcon(name, new vscode.ThemeColor(color));
}

function info(
  label: string,
  description: string,
  tooltip: string,
  icon: string,
  color?: string,
  command?: vscode.Command,
): InfoNode {
  return { kind: 'info', label, description, tooltip, icon: themeIcon(icon, color), command };
}

export class DecisionTreeProvider implements vscode.TreeDataProvider<AnyNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly loader: ProjectDataLoader) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: AnyNode): vscode.TreeItem {
    switch (node.kind) {
      case 'info': {
        const item = new vscode.TreeItem(node.label);
        item.description = node.description;
        item.tooltip = node.tooltip;
        item.iconPath = node.icon;
        if (node.command !== undefined) {
          item.command = node.command;
        }
        return item;
      }
      case 'project': {
        const item = new vscode.TreeItem(
          node.project.name,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.description = node.project.rootPath;
        item.iconPath = themeIcon('root-folder');
        item.contextValue = 'project';
        return item;
      }
      case 'task': {
        const status = TASK_STATUS[node.task.status];
        const item = new vscode.TreeItem(node.task.title, vscode.TreeItemCollapsibleState.Expanded);
        item.description = status.label;
        item.tooltip = new vscode.MarkdownString(
          `**${node.task.title}**\n\n状态：${status.label}\n\n${node.task.goal}`,
        );
        item.iconPath = themeIcon(status.icon);
        item.contextValue = 'task';
        return item;
      }
      case 'decision': {
        const status = DECISION_STATUS[node.decision.status];
        const item = new vscode.TreeItem(
          node.decision.title,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = status.label;
        item.tooltip = new vscode.MarkdownString(
          `**设计问题**：${node.decision.question}\n\n**选择**：${node.decision.chosenOption}\n\n声明于 ${node.decision.declaredAt}（${status.label}）`,
        );
        item.iconPath = themeIcon(status.icon, status.color);
        item.command = {
          command: 'codementor.openDecision',
          title: '查看设计决策详情',
          arguments: [node.decision.id],
        };
        item.contextValue = 'decision';
        return item;
      }
      case 'anchor': {
        const status = ANCHOR_STATUS[node.anchor.status];
        const item = new vscode.TreeItem(
          `${node.anchor.symbolPath[node.anchor.symbolPath.length - 1] ?? '?'}`,
          vscode.TreeItemCollapsibleState.None,
        );
        item.description = `${node.anchor.filePath}:${node.anchor.startLine} · ${status.label}${node.anchor.origin === 'inferred' ? ' · 自动关联' : ''}`;
        item.tooltip = new vscode.MarkdownString(
          `**${node.decisionTitle}**\n\n${node.anchor.filePath}:${node.anchor.startLine}-${node.anchor.endLine}\n\n定位状态：${status.label}${node.anchor.status !== 'confirmed' ? '（显示的是最后已知位置）' : ''}`,
        );
        item.iconPath = themeIcon(status.icon, status.color);
        item.command = {
          command: 'codementor.revealAnchor',
          title: '跳转到关联代码',
          arguments: [node.anchor],
        };
        item.contextValue = 'anchor';
        return item;
      }
    }
  }

  async getChildren(node?: AnyNode): Promise<AnyNode[]> {
    if (node === undefined) {
      const data = await this.loader.get();
      switch (data.state) {
        case 'offline':
          return [
            info(
              '核心服务未连接',
              '启动服务或检查配置',
              'CodeMentor 核心服务（codementor-core）未在本机运行。执行帮助命令查看启动方式。',
              'circle-slash',
              'errorForeground',
              {
                command: 'codementor.showServiceHelp',
                title: '服务连接帮助',
              },
            ),
          ];
        case 'unregistered':
          return [
            info(
              '本工作区尚未注册',
              '打开决策树前需先有工程数据',
              '当前工作区还没有 CodeMentor 项目记录。项目会在 Agent 首次通过 MCP/核心服务登记任务与决策时自动创建。',
              'info',
              undefined,
              {
                command: 'codementor.refresh',
                title: '重新检测',
              },
            ),
          ];
        case 'error':
          return [
            info(
              '加载数据失败',
              data.error ?? '未知错误',
              '读取核心服务数据失败，点击可重试。',
              'warning',
              'editorWarning.foreground',
              { command: 'codementor.refresh', title: '重试' },
            ),
          ];
        case 'ready':
          return [{ kind: 'project', project: data.project! }];
      }
    }

    if (node.kind === 'project') {
      const data = await this.loader.get();
      if (data.tasks.length === 0) {
        return [info('暂无任务', 'Agent 登记任务后显示', '该项目还没有任务记录。', 'info')];
      }
      return data.tasks.map((task) => ({ kind: 'task', task }));
    }

    if (node.kind === 'task') {
      const data = await this.loader.get();
      const decisions = data.decisions.filter(
        (d) => data.taskOfDecision.get(d.id) === node.task.id,
      );
      if (decisions.length === 0) {
        return [info('暂无设计决策', 'Agent 声明决策后显示', '该任务下还没有设计决策。', 'info')];
      }
      return decisions.map((decision) => ({ kind: 'decision', decision }));
    }

    if (node.kind === 'decision') {
      const data = await this.loader.get();
      const anchors = data.anchors.filter((a) => a.decisionId === node.decision.id);
      if (anchors.length === 0) {
        return [info('未关联代码', '锚定后显示', '该决策还没有关联到源码符号。', 'info')];
      }
      return anchors.map((anchor) => ({
        kind: 'anchor',
        anchor,
        decisionTitle: node.decision.title,
      }));
    }

    return [];
  }
}
