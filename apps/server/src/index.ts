import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MappingService } from '@codementor/code-mapping';
import { LearningEngine } from '@codementor/learning-engine';
import { DecisionEngine } from '@codementor/decision-engine';
import { CodeMentorStorage } from '@codementor/storage';
import { loadConfig } from './config.js';
import { startHttpServer } from './http.js';
import { SERVICE_NAME, SERVICE_VERSION } from './identity.js';

export { SERVICE_NAME, SERVICE_VERSION };

/**
 * 本地核心服务引导：
 * 1. 解析配置（CODEMENTOR_HOME / CODEMENTOR_PORT）
 * 2. 打开 SQLite（含迁移）
 * 3. 启动回环 HTTP 并写入服务发现文件 server.json（端口 + 鉴权 token）
 * 4. 信号驱动的优雅退出（关闭连接、清理 server.json）
 */
export async function main(): Promise<void> {
  const config = loadConfig(process.env);
  fs.mkdirSync(config.homeDir, { recursive: true });

  const storage = CodeMentorStorage.open(path.join(config.homeDir, 'codementor.db'));
  const engine = new DecisionEngine(storage);
  const mapping = new MappingService(storage);
  const learning = new LearningEngine(storage);
  const token = randomBytes(32).toString('hex');

  const running = await startHttpServer({ engine, mapping, learning, token, port: config.port });
  const stateFile = path.join(config.homeDir, 'server.json');
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        host: config.host,
        port: running.port,
        token,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    `[codementor-core] v${SERVICE_VERSION} listening on http://${config.host}:${running.port}`,
  );
  console.log(`[codementor-core] discovery file: ${stateFile}`);

  const shutdown = (): void => {
    try {
      fs.rmSync(stateFile, { force: true });
    } catch {
      // 尽力清理即可
    }
    running.server.close(() => {
      storage.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((err: unknown) => {
  console.error('[codementor-core] fatal:', err);
  process.exitCode = 1;
});
