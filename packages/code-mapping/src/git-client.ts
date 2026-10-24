import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitError extends Error {
  constructor(
    readonly command: string,
    readonly stderr: string,
  ) {
    super(`git ${command} failed: ${stderr.trim()}`);
    this.name = 'GitError';
  }
}

export interface FileChange {
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath: string;
  newPath: string;
}

export interface DiffHunk {
  /** 新文件中的起始行（1 基）。 */
  newStart: number;
  /** 新文件中该 hunk 的行数。 */
  newCount: number;
}

/**
 * 只读 Git 客户端：仅执行 diff/show/rev-parse 等查询命令，
 * 永不执行会修改用户仓库的命令（add/commit/checkout/...）。
 * CodeMentor 的时间语义全部来自 commit 与服务端时钟，绝不读取文件修改时间。
 */
export class GitClient {
  constructor(readonly repoPath: string) {}

  private async exec(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.repoPath,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
      return stdout;
    } catch (err) {
      const stderr =
        err instanceof Error && 'stderr' in err && typeof err.stderr === 'string'
          ? err.stderr
          : String(err);
      throw new GitError(args[0] ?? '', stderr);
    }
  }

  /** 当前 HEAD 提交号。 */
  async head(): Promise<string> {
    const out = await this.exec(['rev-parse', 'HEAD']);
    return out.trim();
  }

  /**
   * 两个提交间的文件变更（含重命名检测 -M）。
   * 使用 -z 输出避免路径中特殊字符的转义问题。
   */
  async changedFiles(oldRev: string, newRev: string): Promise<FileChange[]> {
    const out = await this.exec(['diff', '--name-status', '-z', '-M', oldRev, newRev]);
    const tokens = out.split('\0').filter((t) => t.length > 0);
    const changes: FileChange[] = [];
    let i = 0;
    while (i < tokens.length) {
      const status = tokens[i]!;
      const oldPath = tokens[i + 1]!;
      if (status.startsWith('R') || status.startsWith('C')) {
        const newPath = tokens[i + 2]!;
        changes.push({ status: 'renamed', oldPath, newPath });
        i += 3;
      } else {
        const mapped =
          status === 'A' ? 'added' : status === 'D' ? 'deleted' : ('modified' as const);
        changes.push({ status: mapped, oldPath, newPath: oldPath });
        i += 2;
      }
    }
    return changes;
  }

  /** 指定提交下某文件的内容；文件在该提交不存在时返回 undefined。 */
  async fileContent(rev: string, filePath: string): Promise<string | undefined> {
    try {
      return await this.exec(['show', `${rev}:${filePath}`]);
    } catch (err) {
      if (err instanceof GitError && /does not exist|exists on disk, but not in/.test(err.stderr)) {
        return undefined;
      }
      throw err;
    }
  }

  /** 某文件在两个提交间的新增行 hunk（unified=0，只看 + 侧）。 */
  async diffHunks(oldRev: string, newRev: string, filePath: string): Promise<DiffHunk[]> {
    const out = await this.exec(['diff', '--unified=0', oldRev, newRev, '--', filePath]);
    const hunks: DiffHunk[] = [];
    for (const line of out.split('\n')) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (match !== null) {
        hunks.push({
          newStart: Number(match[1]!),
          newCount: match[2] === undefined ? 1 : Number(match[2]),
        });
      }
    }
    return hunks;
  }
}
