import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const ConfigSchema = z.object({
  /** 数据目录：数据库与服务发现文件所在。默认 ~/.codementor，可用 CODEMENTOR_HOME 覆盖。 */
  homeDir: z.string().min(1),
  /** 监听端口；0 表示由操作系统分配（默认）。环境变量是字符串，需要 coerce。 */
  port: z.coerce.number().int().min(0).max(65535),
  /** 服务只允许绑定本机回环地址，不提供配置。 */
  host: z.literal('127.0.0.1'),
});

export interface ServerConfig {
  homeDir: string;
  port: number;
  host: '127.0.0.1';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const homeEnv = env['CODEMENTOR_HOME']?.trim();
  const portEnv = env['CODEMENTOR_PORT']?.trim();
  return ConfigSchema.parse({
    homeDir: homeEnv && homeEnv.length > 0 ? homeEnv : path.join(os.homedir(), '.codementor'),
    port: portEnv && portEnv.length > 0 ? portEnv : 0,
    host: '127.0.0.1',
  });
}
