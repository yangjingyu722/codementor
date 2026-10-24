/**
 * 核心服务 HTTP 客户端（MCP 适配器专用，极简面）。
 * MCP Server 是纯粹的转发层：所有写操作都经核心服务 API，
 * 不直接触碰 SQLite（阶段 2 验收硬性要求）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ServiceState {
  host: string;
  port: number;
  token: string;
}

export function loadServiceState(homeDir?: string): ServiceState | null {
  const dir =
    homeDir ?? process.env['CODEMENTOR_HOME']?.trim() ?? path.join(os.homedir(), '.codementor');
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, 'server.json'), 'utf8'),
    ) as Partial<ServiceState>;
    if (
      typeof parsed.host === 'string' &&
      typeof parsed.port === 'number' &&
      typeof parsed.token === 'string'
    ) {
      return parsed as ServiceState;
    }
    return null;
  } catch {
    return null;
  }
}

export class CoreClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CoreClientError';
  }
}

export class CoreClient {
  constructor(private readonly state: ServiceState) {}

  private async request<T>(method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<T> {
    const res = await fetch(`http://${this.state.host}:${this.state.port}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${this.state.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as T & { error?: { code: string; message: string } };
    if (res.status >= 400) {
      throw new CoreClientError(
        res.status,
        json?.error?.code ?? `HTTP_${res.status}`,
        json?.error?.message ?? JSON.stringify(json).slice(0, 300),
      );
    }
    return json;
  }

  ensureProject(rootPath: string): Promise<{ id: string; name: string }> {
    return this.request('POST', '/api/projects', {
      name: path.basename(rootPath),
      rootPath,
    });
  }

  startTask(
    projectId: string,
    title: string,
    goal: string,
  ): Promise<{ id: string; title: string }> {
    return this.request('POST', '/api/tasks', { projectId, title, goal });
  }

  listTasks(
    projectId: string,
  ): Promise<Array<{ id: string; title: string; status: string; startedAt: string }>> {
    return this.request('GET', `/api/projects/${encodeURIComponent(projectId)}/tasks`);
  }

  declareDecision(body: unknown): Promise<unknown> {
    return this.request('POST', '/api/decisions', body);
  }

  recordObservation(decisionId: string, body: unknown): Promise<unknown> {
    return this.request(
      'POST',
      `/api/decisions/${encodeURIComponent(decisionId)}/observations`,
      body,
    );
  }

  finishTask(taskId: string): Promise<unknown> {
    return this.request('POST', `/api/tasks/${encodeURIComponent(taskId)}/finish`);
  }

  getDecisionBundle(decisionId: string): Promise<unknown> {
    return this.request('GET', `/api/decisions/${encodeURIComponent(decisionId)}`);
  }

  listTaskDecisions(taskId: string): Promise<unknown> {
    return this.request('GET', `/api/tasks/${encodeURIComponent(taskId)}/decisions`);
  }
}
