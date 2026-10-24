import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { DecisionEngine } from '@codementor/decision-engine';
import { isCodeMentorError } from '@codementor/decision-engine';
import type { MappingService } from '@codementor/code-mapping';
import { GitError } from '@codementor/code-mapping';
import type { LearningEngine } from '@codementor/learning-engine';
import { StorageError } from '@codementor/storage';
import { SERVICE_NAME, SERVICE_VERSION } from './identity.js';

const MAX_BODY_BYTES = 1024 * 1024;

export interface HttpOptions {
  engine: DecisionEngine;
  /** 缺省时锚点相关路由返回 503（Phase 1 兼容形态）。 */
  mapping?: MappingService;
  /** 缺省时学习相关路由返回 503（Phase 4 兼容形态）。 */
  learning?: LearningEngine;
  token: string;
  /** 0 或缺省表示由操作系统分配。 */
  port?: number;
}

export interface RunningHttpServer {
  server: http.Server;
  port: number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface HandlerContext {
  params: Record<string, string>;
  query: URLSearchParams;
  engine: DecisionEngine;
  mapping?: MappingService;
  learning?: LearningEngine;
  body: unknown;
}

function requireLearning(ctx: HandlerContext): LearningEngine {
  if (ctx.learning === undefined) {
    throw new HttpError(503, 'LEARNING_UNAVAILABLE', 'learning service not configured');
  }
  return ctx.learning;
}

interface Route {
  method: 'GET' | 'POST';
  segments: string[];
  isPublic?: boolean;
  handler: (ctx: HandlerContext) => unknown | Promise<unknown>;
}

function requireMapping(ctx: HandlerContext): MappingService {
  if (ctx.mapping === undefined) {
    throw new HttpError(503, 'MAPPING_UNAVAILABLE', 'code mapping service not configured');
  }
  return ctx.mapping;
}

interface Route {
  method: 'GET' | 'POST';
  segments: string[];
  isPublic?: boolean;
  handler: (ctx: HandlerContext) => unknown | Promise<unknown>;
}

const ROUTES: Route[] = [
  {
    method: 'GET',
    segments: ['health'],
    isPublic: true,
    handler: () => ({ service: SERVICE_NAME, version: SERVICE_VERSION, status: 'ok' }),
  },
  {
    method: 'POST',
    segments: ['api', 'projects'],
    handler: (ctx) => ctx.engine.registerProject(ctx.body),
  },
  {
    method: 'POST',
    segments: ['api', 'tasks'],
    handler: (ctx) => ctx.engine.startTask(ctx.body),
  },
  {
    method: 'POST',
    segments: ['api', 'tasks', ':id', 'finish'],
    handler: (ctx) => ctx.engine.finishTask(requireParam(ctx, 'id')),
  },
  {
    method: 'POST',
    segments: ['api', 'decisions'],
    handler: (ctx) => ctx.engine.declareDecision(ctx.body),
  },
  {
    method: 'POST',
    segments: ['api', 'decisions', ':id', 'implement'],
    handler: (ctx) => ctx.engine.markImplemented(requireParam(ctx, 'id')),
  },
  {
    method: 'POST',
    segments: ['api', 'decisions', ':id', 'observations'],
    handler: (ctx) => ctx.engine.recordObservation(ctx.body),
  },
  {
    method: 'POST',
    segments: ['api', 'decisions', ':id', 'rationalizations'],
    handler: (ctx) => ctx.engine.recordRationalization(ctx.body),
  },
  {
    method: 'POST',
    segments: ['api', 'decisions', ':id', 'verify'],
    handler: (ctx) => ctx.engine.verifyDecision(requireParam(ctx, 'id')),
  },
  {
    method: 'GET',
    segments: ['api', 'decisions', ':id'],
    handler: (ctx) => ctx.engine.getDecisionBundle(requireParam(ctx, 'id')),
  },
  {
    method: 'GET',
    segments: ['api', 'tasks', ':id', 'decisions'],
    handler: (ctx) => ctx.engine.listTaskDecisions(requireParam(ctx, 'id')),
  },
  {
    method: 'POST',
    segments: ['api', 'decisions', ':id', 'anchors'],
    handler: (ctx) =>
      requireMapping(ctx).createAnchor({
        ...(ctx.body as Record<string, unknown>),
        decisionId: requireParam(ctx, 'id'),
      }),
  },
  {
    method: 'GET',
    segments: ['api', 'decisions', ':id', 'anchors'],
    handler: (ctx) => requireMapping(ctx).listAnchors(requireParam(ctx, 'id')),
  },
  {
    method: 'GET',
    segments: ['api', 'symbols', 'lookup'],
    handler: (ctx) => {
      const mapping = requireMapping(ctx);
      const filePath = ctx.query.get('filePath');
      const symbol = ctx.query.get('symbol');
      if (filePath === null || filePath.length === 0 || symbol === null || symbol.length === 0) {
        throw new HttpError(400, 'VALIDATION', 'query requires filePath and symbol');
      }
      return { matches: mapping.findDecisionsForSymbol(filePath, symbol) };
    },
  },
  {
    method: 'GET',
    segments: ['api', 'projects', 'lookup'],
    handler: (ctx) => {
      const rootPath = ctx.query.get('rootPath');
      if (rootPath === null || rootPath.length === 0) {
        throw new HttpError(400, 'VALIDATION', 'query requires rootPath');
      }
      const project = ctx.engine.findProjectByRootPath(rootPath);
      if (project === undefined) {
        throw new HttpError(404, 'NOT_FOUND', `no project registered for rootPath ${rootPath}`);
      }
      return project;
    },
  },
  {
    method: 'GET',
    segments: ['api', 'projects', ':id', 'tasks'],
    handler: (ctx) => ctx.engine.getProjectTasks(requireParam(ctx, 'id')),
  },
  {
    method: 'GET',
    segments: ['api', 'projects', ':id', 'anchors'],
    handler: (ctx) => requireMapping(ctx).listProjectAnchors(requireParam(ctx, 'id')),
  },
  {
    method: 'POST',
    segments: ['api', 'projects', ':id', 'anchors', 'revalidate'],
    handler: (ctx) => requireMapping(ctx).revalidateProject(requireParam(ctx, 'id')),
  },
  {
    method: 'POST',
    segments: ['api', 'decisions', ':id', 'learning'],
    handler: (ctx) => requireLearning(ctx).generateSession(requireParam(ctx, 'id')),
  },
  {
    method: 'GET',
    segments: ['api', 'decisions', ':id', 'learning'],
    handler: (ctx) => ({ session: requireLearning(ctx).getSession(requireParam(ctx, 'id')) }),
  },
  {
    method: 'POST',
    segments: ['api', 'exercises', ':id', 'attempts'],
    handler: (ctx) => requireLearning(ctx).submitAttempt(requireParam(ctx, 'id'), ctx.body),
  },
];

function requireParam(ctx: HandlerContext, name: string): string {
  const value = ctx.params[name];
  if (value === undefined || value.length === 0) {
    throw new HttpError(400, 'VALIDATION', `missing path parameter ${name}`);
  }
  return value;
}

function matchRoute(
  method: string,
  segments: string[],
): { route: Route; params: Record<string, string> } | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' {
  let pathExists = false;
  for (const route of ROUTES) {
    if (route.segments.length !== segments.length) {
      continue;
    }
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < route.segments.length; i++) {
      const pattern = route.segments[i]!;
      const actual = segments[i]!;
      if (pattern.startsWith(':')) {
        params[pattern.slice(1)] = decodeURIComponent(actual);
      } else if (pattern !== actual) {
        matched = false;
        break;
      }
    }
    if (!matched) {
      continue;
    }
    pathExists = true;
    if (route.method === method) {
      return { route, params };
    }
  }
  return pathExists ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND';
}

function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') {
    return false;
  }
  const expected = `Bearer ${token}`;
  const given = Buffer.from(header);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // 先按 Content-Length 预检，避免上传超限请求体
    const declaredLength = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'request body exceeds 1MB'));
      req.resume();
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      if (overflowed) {
        return;
      }
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        overflowed = true;
        chunks.length = 0;
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'request body exceeds 1MB'));
        // 排水丢弃剩余数据而非销毁 socket，保证 413 响应能送达客户端
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflowed) {
        return;
      }
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', 'request body is not valid JSON'));
      }
    });
    req.on('error', (err) => {
      if (!overflowed) {
        reject(err);
      }
    });
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function errorStatus(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION':
    case 'INVALID_JSON':
      return 400;
    case 'INVALID_STATE':
      return 409;
    case 'INTEGRITY_VIOLATION':
      return 422;
    default:
      return 500;
  }
}

/** 启动回环 HTTP 服务：唯一暴露核心引擎的进程内通道。 */
export function startHttpServer(options: HttpOptions): Promise<RunningHttpServer> {
  const { engine, token } = options;

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const segments = url.pathname.split('/').filter((s) => s.length > 0);
      const method = req.method ?? 'GET';
      const matched = matchRoute(method, segments);

      if (matched === 'NOT_FOUND') {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'unknown route' } });
        return;
      }
      if (matched === 'METHOD_NOT_ALLOWED') {
        sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'wrong method' } });
        return;
      }

      if (!matched.route.isPublic && !isAuthorized(req, token)) {
        sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'missing or bad token' } });
        return;
      }

      const body = method === 'POST' ? await readJsonBody(req) : undefined;
      const result = await matched.route.handler({
        params: matched.params,
        query: url.searchParams,
        engine,
        mapping: options.mapping,
        learning: options.learning,
        body,
      });
      sendJson(res, method === 'POST' ? 201 : 200, result ?? {});
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: { code: err.code, message: err.message } });
        return;
      }
      if (isCodeMentorError(err)) {
        sendJson(res, errorStatus(err.code), {
          error: { code: err.code, message: err.message, details: err.details },
        });
        return;
      }
      if (err instanceof StorageError) {
        const status = err.code === 'NOT_FOUND' ? 404 : 409;
        sendJson(res, status, { error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof GitError) {
        console.error('[codementor-core] git error:', err.message);
        sendJson(res, 500, { error: { code: 'GIT_ERROR', message: err.message } });
        return;
      }
      console.error('[codementor-core] unhandled error:', err);
      sendJson(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } });
    }
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('failed to determine listening port'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}
