/**
 * OpenCode 事件适配器（阶段 2）：
 * 订阅 OpenCode 插件事件 → 归一化为 CodeMentor AgentEvent → 提交核心服务。
 *
 * 隐私边界：只读取事件中的文件路径与会话 ID 等显式字段，绝不读取
 * Agent 私有数据、对话内容或凭据；无法归一化的事件以 type=other 透传最小 payload。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentEventType } from './types.js';

export interface RawEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export interface NormalizedEvent {
  agent: 'opencode';
  type: AgentEventType;
  sessionId: string;
  payload: Record<string, unknown>;
}

/** OpenCode 事件类型 → AgentEvent 类型的显式映射；未识别事件归入 other。 */
export function mapEventType(openCodeType: string): AgentEventType {
  if (openCodeType.startsWith('file.')) {
    return 'file_edit';
  }
  if (openCodeType.startsWith('session.created') || openCodeType.startsWith('session.started')) {
    return 'session_start';
  }
  if (openCodeType.startsWith('session.deleted') || openCodeType.startsWith('session.error')) {
    return 'session_end';
  }
  if (openCodeType.startsWith('tool.')) {
    return 'tool_call';
  }
  if (openCodeType.startsWith('test.') || openCodeType.includes('test_run')) {
    return 'test_run';
  }
  if (openCodeType.startsWith('message.')) {
    return 'message';
  }
  return 'other';
}

/** 只提取显式字段：sessionID / file / tool 等顶层键；绝不透传凭据类键。 */
const FORBIDDEN_KEYS = ['apikey', 'api_key', 'token', 'password', 'secret', 'credential'];

function sanitize(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (FORBIDDEN_KEYS.some((f) => key.toLowerCase().includes(f))) {
      out[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

export function normalizeOpenCodeEvent(raw: RawEvent): NormalizedEvent {
  const properties = raw.properties ?? {};
  const sessionId = [
    properties['sessionID'],
    properties['sessionId'],
    properties['session_id'],
  ].find((v) => typeof v === 'string');
  return {
    agent: 'opencode',
    type: mapEventType(raw.type),
    sessionId: typeof sessionId === 'string' ? sessionId : 'unknown',
    payload: { source: raw.type, ...sanitize(properties) },
  };
}

export interface AdapterOptions {
  /** 核心服务数据目录（默认 ~/.codementor 或 CODEMENTOR_HOME）。 */
  coreHome?: string;
  /** 仓库根目录：决定事件归属的项目与任务。 */
  projectRoot: string;
}

export function loadCoreEndpoint(coreHome?: string): { port: number; token: string } | null {
  const dir = coreHome ?? process.env['CODEMENTOR_HOME'] ?? path.join(os.homedir(), '.codementor');
  try {
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'server.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    return { port: state.port, token: state.token };
  } catch {
    return null;
  }
}

/** 创建 OpenCode 插件事件处理器：.opencode/plugin/codementor.js 直接引用。 */
export function createCodementorPlugin(options: AdapterOptions): {
  event: (input: { event: RawEvent }) => Promise<void>;
} {
  return {
    event: async ({ event }: { event: RawEvent }): Promise<void> => {
      const endpoint = loadCoreEndpoint(options.coreHome);
      if (endpoint === null) {
        return; // 服务未运行：静默降级，绝不阻塞 Agent
      }
      const normalized = normalizeOpenCodeEvent(event);
      try {
        await fetch(`http://127.0.0.1:${endpoint.port}/api/events`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${endpoint.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            projectRoot: path.resolve(options.projectRoot),
            sessionId: normalized.sessionId,
            agent: normalized.agent,
            type: normalized.type,
            payload: normalized.payload,
          }),
        });
      } catch {
        // 观测通道失败不阻塞开发流程（降级语义，ADR-0009）
      }
    },
  };
}
