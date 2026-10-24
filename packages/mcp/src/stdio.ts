/**
 * CodeMentor MCP Server（stdio）——Agent 接入的正式通道。
 *
 * 设计硬约束（阶段 2 验收）：
 * - 5 个工具，输入输出 Schema 严格（JSON Schema，additionalProperties:false）；
 * - 本进程是纯粹的转发层：所有读写都经核心服务 HTTP API，不触碰 SQLite；
 * - declaredAt 由核心服务时钟盖章（本进程无任何时间注入路径）；
 * - 不提供"补录历史决策"类工具——降级场景下不存在事前声明，只能事后标注
 *   rationalized（经核心服务 HTTP，本 MCP 不暴露该路径给 Agent）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { CoreClient, CoreClientError, loadServiceState } from './core-client.js';

const TOOL_SCHEMAS = {
  mentor_start_task: {
    description:
      '开始一个开发任务：注册项目（按工作区根路径幂等）并创建任务。必须在 mentor_record_decision 之前调用。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: '仓库根目录绝对路径，默认当前工作目录' },
        title: { type: 'string', description: '任务标题（正在做什么）' },
        goal: { type: 'string', description: '任务目标（可选）' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  mentor_record_decision: {
    description:
      '在写代码之前声明一条设计决策：问题、选中的方案、被否决的备选方案、理由（至少一条）。' +
      'declaredAt 由核心服务时钟盖章，用于区分事前声明与事后解释。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        question: { type: 'string', description: '这条决策要回答的设计问题' },
        chosenOption: { type: 'string' },
        decidedBy: { type: 'string', enum: ['agent', 'human', 'pair'] },
        alternatives: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, summary: { type: 'string' } },
            required: ['name'],
            additionalProperties: false,
          },
          description: '被记录但未选择的备选方案',
        },
        claims: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['constraint', 'tradeoff', 'risk', 'benefit'] },
              statement: { type: 'string' },
            },
            required: ['kind', 'statement'],
            additionalProperties: false,
          },
          description: '设计理由（至少一条）',
        },
      },
      required: ['title', 'question', 'chosenOption', 'claims'],
      additionalProperties: false,
    },
  },
  mentor_record_verification: {
    description:
      '为实现后的决策登记验证：一条观察主张 + 机器可核查的证据（测试运行/diff 等）。verdict=pass 时主张被标记为 supported。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        decisionId: { type: 'string', description: '缺省时使用当前任务最新声明的决策' },
        claim: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['constraint', 'tradeoff', 'risk', 'benefit'] },
            statement: { type: 'string', description: '观察到的事实主张' },
          },
          required: ['kind', 'statement'],
          additionalProperties: false,
        },
        evidence: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['test_run', 'diff', 'build_log', 'manual_note'] },
            verdict: { type: 'string', enum: ['pass', 'fail', 'unknown'] },
            contentRef: { type: 'string', description: '证据内容引用（本地路径或哈希）' },
            summary: { type: 'string' },
          },
          required: ['kind', 'verdict', 'contentRef'],
          additionalProperties: false,
        },
      },
      required: ['claim', 'evidence'],
      additionalProperties: false,
    },
  },
  mentor_finish_task: {
    description: '完成任务（active → completed）。',
    inputSchema: {
      type: 'object' as const,
      properties: { taskId: { type: 'string', description: '缺省时使用当前活跃任务' } },
      additionalProperties: false,
    },
  },
  mentor_get_context: {
    description:
      '读取上下文：指定 decisionId 返回决策全貌（含主张/证据/锚点/完整性）；否则返回当前任务的决策列表。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        decisionId: { type: 'string' },
        taskId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
};

function textResult(payload: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

export interface McpServerHandles {
  server: Server;
}

export function createMcpServer(options: { coreHome?: string } = {}): McpServerHandles {
  const state = loadServiceState(options.coreHome);
  if (state === null) {
    const home =
      options.coreHome ?? process.env['CODEMENTOR_HOME'] ?? path.join(os.homedir(), '.codementor');
    console.error(
      `[codementor-mcp] 核心服务未启动（找不到 ${path.join(home, 'server.json')}）。` +
        `请先运行 pnpm --filter @codementor/server start`,
    );
    process.exit(1);
  }
  const client = new CoreClient(state);

  /** 会话内记住 mentor_start_task 建立的项目根（后续工具沿用）。 */
  let activeProjectRoot: string | undefined;

  async function currentProject(explicit?: string): Promise<{ id: string; rootPath: string }> {
    const rootPath = path.resolve(explicit ?? activeProjectRoot ?? process.cwd());
    const project = (await client.ensureProject(rootPath)) as { id: string };
    return { id: project.id, rootPath };
  }

  /** 当前活跃任务：项目下最新 active；没有则报错并提示先调 mentor_start_task。 */
  async function currentTask(projectId: string): Promise<{ id: string; title: string }> {
    const tasks = (await client.listTasks(projectId)) as Array<{
      id: string;
      title: string;
      status: string;
      startedAt: string;
    }>;
    const active = tasks.filter((t) => t.status === 'active').at(-1);
    if (active === undefined) {
      throw new CoreClientError(
        409,
        'NO_ACTIVE_TASK',
        '当前项目没有进行中的任务，请先调用 mentor_start_task',
      );
    }
    return active;
  }

  async function latestDecisionOf(projectId: string): Promise<string> {
    const task = await currentTask(projectId);
    const decisions = (await client.listTaskDecisions(task.id)) as Array<{ id: string }>;
    const latest = decisions.at(-1);
    if (latest === undefined) {
      throw new CoreClientError(
        404,
        'NO_DECISIONS',
        '当前任务还没有决策，请先调用 mentor_record_decision',
      );
    }
    return latest.id;
  }

  const server = new Server(
    { name: 'codementor-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
      name,
      description: schema.description,
      inputSchema: schema.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    try {
      switch (name) {
        case 'mentor_start_task': {
          const project = await currentProject(
            typeof args['projectRoot'] === 'string' ? args['projectRoot'] : undefined,
          );
          activeProjectRoot = project.rootPath;
          const task = await client.startTask(
            project.id,
            String(args['title']),
            typeof args['goal'] === 'string' ? args['goal'] : '',
          );
          return textResult({
            projectId: project.id,
            projectRoot: project.rootPath,
            taskId: task.id,
            title: task.title,
            status: 'active',
          });
        }
        case 'mentor_record_decision': {
          const project = await currentProject();
          const task = await currentTask(project.id);
          const result = (await client.declareDecision({
            taskId: task.id,
            title: args['title'],
            question: args['question'],
            chosenOption: args['chosenOption'],
            decidedBy: args['decidedBy'] ?? 'agent',
            alternatives: args['alternatives'] ?? [],
            declaredClaims: args['claims'],
          })) as { decision: { id: string; declaredAt: string }; claims: Array<{ id: string }> };
          return textResult({
            decisionId: result.decision.id,
            declaredAt: result.decision.declaredAt,
            claimIds: result.claims.map((c) => c.id),
            note: '决策已在编码前声明（declaredAt 服务端盖章）',
          });
        }
        case 'mentor_record_verification': {
          const project = await currentProject();
          const decisionId =
            typeof args['decisionId'] === 'string'
              ? args['decisionId']
              : await latestDecisionOf(project.id);
          const result = (await client.recordObservation(decisionId, {
            decisionId,
            claim: args['claim'],
            evidence: args['evidence'],
          })) as { claim: { id: string; verification: string }; evidence: { id: string } };
          return textResult({
            claimId: result.claim.id,
            verification: result.claim.verification,
            evidenceId: result.evidence.id,
          });
        }
        case 'mentor_finish_task': {
          const project = await currentProject();
          const taskId =
            typeof args['taskId'] === 'string'
              ? args['taskId']
              : (await currentTask(project.id)).id;
          const result = (await client.finishTask(taskId)) as { id: string; status: string };
          return textResult({ taskId: result.id, status: result.status });
        }
        case 'mentor_get_context': {
          if (typeof args['decisionId'] === 'string') {
            return textResult(await client.getDecisionBundle(args['decisionId']));
          }
          const project = await currentProject();
          const taskId =
            typeof args['taskId'] === 'string'
              ? args['taskId']
              : (await currentTask(project.id)).id;
          return textResult(await client.listTaskDecisions(taskId));
        }
        default:
          return textResult({ error: `unknown tool: ${name}` }, true);
      }
    } catch (err) {
      const message =
        err instanceof CoreClientError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      return textResult({ error: message }, true);
    }
  });

  return { server };
}

/** stdio 入口：被 Agent 直接拉起。 */
export async function runStdio(): Promise<void> {
  const { server } = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[codementor-mcp] stdio transport connected');
}

export function serviceStateAvailable(coreHome?: string): boolean {
  const dir = coreHome ?? process.env['CODEMENTOR_HOME'] ?? path.join(os.homedir(), '.codementor');
  return fs.existsSync(path.join(dir, 'server.json'));
}
