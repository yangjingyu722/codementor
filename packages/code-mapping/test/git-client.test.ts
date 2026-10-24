import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitClient } from '../src/git-client.js';
import { TestRepo } from './test-repo.js';

describe('GitClient（真实临时 git 仓库，只读操作）', () => {
  let repo: TestRepo;
  let client: GitClient;
  let v1: string;
  let v2: string;
  let v3: string;

  beforeAll(() => {
    repo = new TestRepo('cm-git-');
    repo.write('a.txt', 'one\n');
    repo.write('sub/b.txt', 'hello\n');
    v1 = repo.commit('init');
    repo.write('a.txt', 'one\ntwo\n');
    repo.write('c.txt', 'new file\n');
    repo.rm('sub/b.txt');
    v2 = repo.commit('modify add delete');
    repo.mv('c.txt', 'renamed.txt');
    v3 = repo.commit('rename');
    client = new GitClient(repo.root);
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('head 返回当前提交', async () => {
    expect(await client.head()).toBe(v3);
  });

  it('changedFiles 识别新增/修改/删除', async () => {
    const changes = await client.changedFiles(v1, v2);
    const byPath = new Map(changes.map((c) => [c.oldPath, c]));
    expect(byPath.get('a.txt')?.status).toBe('modified');
    expect(byPath.get('c.txt')?.status).toBe('added');
    expect(byPath.get('sub/b.txt')?.status).toBe('deleted');
  });

  it('changedFiles 识别重命名（-M）', async () => {
    const changes = await client.changedFiles(v2, v3);
    const rename = changes.find((c) => c.status === 'renamed');
    expect(rename).toMatchObject({ oldPath: 'c.txt', newPath: 'renamed.txt' });
  });

  it('fileContent 按提交取内容；不存在的文件返回 undefined', async () => {
    expect(await client.fileContent(v1, 'a.txt')).toBe('one\n');
    expect(await client.fileContent(v2, 'a.txt')).toBe('one\ntwo\n');
    expect(await client.fileContent(v1, 'c.txt')).toBeUndefined();
  });

  it('diffHunks 返回新文件侧行区间', async () => {
    const hunks = await client.diffHunks(v1, v2, 'a.txt');
    expect(hunks).toEqual([{ newStart: 2, newCount: 1 }]);
  });
});
