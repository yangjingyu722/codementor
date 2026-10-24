import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const IDENTITY = [
  '-c',
  'user.name=CodeMentor Test',
  '-c',
  'user.email=cm-test@codementor.local',
  '-c',
  'commit.gpgsign=false',
];

/**
 * 测试用真实 git 仓库：在临时目录 init 并按场景提交。
 * CodeMentor 生产代码只读仓库；写入只发生在测试助手层。
 */
export class TestRepo {
  readonly root: string;

  constructor(prefix = 'cm-repo-') {
    this.root = fs.mkdtempSync(path.join(tmpdir(), prefix));
    this.git(['init', '-b', 'main']);
  }

  git(args: string[]): string {
    return execFileSync('git', [...IDENTITY, ...args], {
      cwd: this.root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  }

  write(relPath: string, content: string): void {
    const abs = path.join(this.root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  commit(message: string): string {
    this.git(['add', '-A']);
    this.git(['commit', '-m', message]);
    return this.head();
  }

  mv(from: string, to: string): void {
    this.git(['mv', from, to]);
  }

  rm(relPath: string): void {
    this.git(['rm', relPath]);
  }

  head(): string {
    return this.git(['rev-parse', 'HEAD']).trim();
  }

  rev(offset: number): string {
    return this.git(['rev-parse', `HEAD~${offset}`]).trim();
  }

  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}
