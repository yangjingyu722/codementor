import fs from 'node:fs';
import * as http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type {
  Claim,
  CodeAnchor,
  Decision,
  Evidence,
  IntegrityResult,
  Project,
  Task,
} from '@codementor/contracts';

/** server.json 的形状（由 apps/server 写入）。 */
export interface ServiceState {
  service: string;
  version: string;
  host: string;
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

/** 核心服务未运行或无法连接。视图层应展示引导信息而非弹窗轰炸。 */
export class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

/** 核心服务返回的结构化错误（VALIDATION / NOT_FOUND / ...）。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function defaultHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env['CODEMENTOR_HOME']?.trim();
  return fromEnv !== undefined && fromEnv.length > 0
    ? fromEnv
    : path.join(os.homedir(), '.codementor');
}

/**
 * 服务发现：读取 <homeDir>/server.json（端口/token 握手）。
 * 每次解析都重读文件——服务重启后文件会被重建。
 */
export class ServiceLocator {
  constructor(readonly homeDir: string | (() => string)) {}

  private dir(): string {
    return typeof this.homeDir === 'function' ? this.homeDir() : this.homeDir;
  }

  resolve(): ServiceState | null {
    try {
      const file = path.join(this.dir(), 'server.json');
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ServiceState>;
      if (
        typeof parsed.host === 'string' &&
        typeof parsed.port === 'number' &&
        typeof parsed.token === 'string' &&
        parsed.token.length > 0
      ) {
        return parsed as ServiceState;
      }
      return null;
    } catch {
      return null;
    }
  }
}

export interface DecisionDetail {
  decision: Decision;
  claims: Claim[];
  evidence: Evidence[];
  integrity: IntegrityResult;
}

/**
 * 核心服务 HTTP 客户端（纯 Node，无 vscode 依赖，可被 Vitest 直接测试）。
 * 扩展只读：不提供任何写端点封装——写路径属于 Agent（MCP）与命令行。
 */
export class ApiClient {
  constructor(
    private readonly locator: ServiceLocator,
    private readonly timeoutMs = 5000,
  ) {}

  private request<T>(
    method: 'GET' | 'POST',
    pathname: string,
    query?: Record<string, string>,
    body?: unknown,
  ): Promise<T> {
    const state = this.locator.resolve();
    if (state === null) {
      return Promise.reject(
        new ServiceUnavailableError('未找到核心服务发现文件 server.json，服务可能未启动'),
      );
    }
    const search = query ? new URLSearchParams(query).toString() : '';
    const fullPath = search.length > 0 ? `${pathname}?${search}` : pathname;

    return new Promise<T>((resolve, reject) => {
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
      const req = http.request(
        {
          host: state.host,
          port: state.port,
          path: fullPath,
          method,
          headers: {
            authorization: `Bearer ${state.token}`,
            ...(payload === null
              ? {}
              : { 'content-type': 'application/json', 'content-length': payload.length }),
          },
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            if (status >= 400) {
              let code = `HTTP_${status}`;
              let message = text.slice(0, 300);
              let details: unknown;
              try {
                const parsed = JSON.parse(text) as {
                  error?: { code?: string; message?: string; details?: unknown };
                };
                code = parsed.error?.code ?? code;
                message = parsed.error?.message ?? message;
                details = parsed.error?.details;
              } catch {
                // 保留原始文本
              }
              reject(new ApiError(status, code, message, details));
              return;
            }
            try {
              resolve(text.length === 0 ? (undefined as T) : (JSON.parse(text) as T));
            } catch (err) {
              reject(new ApiError(status, 'BAD_RESPONSE', `响应不是合法 JSON: ${String(err)}`));
            }
          });
        },
      );
      req.on('timeout', () => {
        req.destroy(new ServiceUnavailableError('核心服务请求超时'));
      });
      req.on('error', (err) => {
        if (err instanceof ServiceUnavailableError || err instanceof ApiError) {
          reject(err);
        } else {
          reject(new ServiceUnavailableError(`无法连接核心服务: ${err.message}`));
        }
      });
      if (payload !== null) {
        req.write(payload);
      }
      req.end();
    });
  }

  async health(): Promise<void> {
    await this.request<{ status: string }>('GET', '/health');
  }

  /** 工作区识别：未注册返回 undefined（不视为错误）。 */
  async lookupProject(rootPath: string): Promise<Project | undefined> {
    try {
      return await this.request<Project>('GET', '/api/projects/lookup', { rootPath });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return undefined;
      }
      throw err;
    }
  }

  async listTasks(projectId: string): Promise<Task[]> {
    return this.request<Task[]>('GET', `/api/projects/${encodeURIComponent(projectId)}/tasks`);
  }

  async listTaskDecisions(taskId: string): Promise<Decision[]> {
    return this.request<Decision[]>('GET', `/api/tasks/${encodeURIComponent(taskId)}/decisions`);
  }

  async getDecisionDetail(decisionId: string): Promise<DecisionDetail> {
    return this.request<DecisionDetail>('GET', `/api/decisions/${encodeURIComponent(decisionId)}`);
  }

  async listAnchors(decisionId: string): Promise<CodeAnchor[]> {
    return this.request<CodeAnchor[]>(
      'GET',
      `/api/decisions/${encodeURIComponent(decisionId)}/anchors`,
    );
  }

  async listProjectAnchors(projectId: string): Promise<CodeAnchor[]> {
    return this.request<CodeAnchor[]>(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}/anchors`,
    );
  }

  async revalidateAnchors(projectId: string): Promise<{
    head: string;
    results: Array<{ anchorId: string; status: string; relocated: boolean }>;
  }> {
    return this.request(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/anchors/revalidate`,
    );
  }
}
