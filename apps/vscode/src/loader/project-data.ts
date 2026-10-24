import type { CodeAnchor, Decision, Project, Task } from '@codementor/contracts';
import type { ApiClient } from '../client/api-client';

/** 工程数据的统一快照：TreeView 与 CodeLens 共用，带短 TTL 缓存。 */
export interface ProjectData {
  state: 'offline' | 'unregistered' | 'ready' | 'error';
  project?: Project;
  tasks: Task[];
  /** 任务展平后的全部决策（按任务分组信息保留在 task 引用上）。 */
  decisions: Decision[];
  /** 决策归属任务 ID（展平后回溯用）。 */
  taskOfDecision: Map<string, string>;
  anchors: CodeAnchor[];
  error?: string;
}

const EMPTY: ProjectData = {
  state: 'offline',
  tasks: [],
  decisions: [],
  taskOfDecision: new Map(),
  anchors: [],
};

/**
 * 单一数据源：一次加载拉取项目/任务/决策/锚点并缓存；
 * 刷新命令与重验证命令负责失效。离线/未注册/错误都是显式状态，不抛异常打断 UI。
 */
export class ProjectDataLoader {
  private cache?: { at: number; data: ProjectData };
  private inflight?: Promise<ProjectData>;

  constructor(
    private readonly client: ApiClient,
    private readonly workspaceRoot: () => string | undefined,
    private readonly ttlMs = 5000,
  ) {}

  async get(force = false): Promise<ProjectData> {
    if (!force && this.cache !== undefined && Date.now() - this.cache.at < this.ttlMs) {
      return this.cache.data;
    }
    this.inflight ??= this.load().finally(() => {
      this.inflight = undefined;
    });
    const data = await this.inflight;
    this.cache = { at: Date.now(), data };
    return data;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  private async load(): Promise<ProjectData> {
    const rootPath = this.workspaceRoot();
    if (rootPath === undefined) {
      return { ...EMPTY, state: 'unregistered', taskOfDecision: new Map() };
    }
    try {
      await this.client.health();
    } catch {
      return { ...EMPTY, state: 'offline', taskOfDecision: new Map() };
    }

    try {
      const project = await this.client.lookupProject(rootPath);
      if (project === undefined) {
        return { ...EMPTY, state: 'unregistered', taskOfDecision: new Map() };
      }
      const tasks = await this.client.listTasks(project.id);
      const decisions: Decision[] = [];
      const taskOfDecision = new Map<string, string>();
      for (const task of tasks) {
        const list = await this.client.listTaskDecisions(task.id);
        for (const decision of list) {
          decisions.push(decision);
          taskOfDecision.set(decision.id, task.id);
        }
      }
      const anchors = await this.client.listProjectAnchors(project.id);
      return { state: 'ready', project, tasks, decisions, taskOfDecision, anchors };
    } catch (err) {
      return {
        ...EMPTY,
        state: 'error',
        error: err instanceof Error ? err.message : String(err),
        taskOfDecision: new Map(),
      };
    }
  }
}
