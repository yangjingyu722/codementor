export type ErrorCode =
  /** 目标实体不存在 */
  | 'NOT_FOUND'
  /** 输入未通过 schema 校验 */
  | 'VALIDATION'
  /** 当前状态不允许该操作 */
  | 'INVALID_STATE'
  /** 完整性规则（R1–R5）未满足 */
  | 'INTEGRITY_VIOLATION';

export class CodeMentorError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CodeMentorError';
  }
}

export function isCodeMentorError(value: unknown): value is CodeMentorError {
  return value instanceof CodeMentorError;
}
