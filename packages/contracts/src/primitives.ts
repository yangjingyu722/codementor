import { z } from 'zod';

/** 非空字符串：名称、说明类字段的底线约束。 */
export const nonEmptyString = z.string().min(1);

/** 不透明实体 ID。由存储层生成，契约层只校验非空。 */
export const entityId = nonEmptyString;

/**
 * ISO 8601 UTC 时间戳：必须以 Z 结尾、禁止时区偏移。
 * 统一格式保证时间戳可按字符串字典序直接比较（完整性校验依赖这一点）。
 */
export const isoTimestamp = z.string().datetime();

/** git commit SHA-1（40 位小写十六进制）。 */
export const commitSha = z
  .string()
  .regex(/^[0-9a-f]{40}$/, 'must be a 40-char lowercase git SHA-1');

/** 仓库内相对路径：POSIX 风格，不允许以 / 开头或包含反斜杠。 */
export const repoRelativePath = nonEmptyString.refine(
  (p) => !p.startsWith('/') && !p.includes('\\'),
  { message: 'must be a POSIX-style repo-relative path' },
);
