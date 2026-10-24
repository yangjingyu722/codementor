import { describe, expect, it } from 'vitest';
import { CSourceParser } from '../src/c-parser.js';
import { ParserRegistry } from '../src/symbols.js';

const parser = new CSourceParser();

describe('CSourceParser（tree-sitter）', () => {
  it('提取函数定义与行范围', () => {
    const src = `#include "proc.h"\nvoid scheduler(void) {\n  run();\n}\n`;
    const { symbols, hasErrors } = parser.parse(src);
    expect(hasErrors).toBe(false);
    const fn = symbols.find((s) => s.name === 'scheduler');
    expect(fn).toMatchObject({ kind: 'function', startLine: 2, endLine: 4 });
  });

  it('提取指针返回值函数名（declarator 包裹下钻）', () => {
    const src = `void *alloc_pcb(void) { return 0; }\n`;
    const { symbols } = parser.parse(src);
    expect(symbols.find((s) => s.name === 'alloc_pcb')).toMatchObject({ kind: 'function' });
  });

  it('提取结构体定义与 typedef 别名', () => {
    const src = `typedef struct pcb { int pid; } pcb_t;\nstruct pcb_list { pcb_t items[8]; int n; };\n`;
    const { symbols } = parser.parse(src);
    expect(symbols.find((s) => s.name === 'pcb' && s.kind === 'struct')).toMatchObject({
      startLine: 1,
      endLine: 1,
    });
    expect(symbols.find((s) => s.name === 'pcb_t' && s.kind === 'typedef')).toBeDefined();
    expect(symbols.find((s) => s.name === 'pcb_list')).toMatchObject({ kind: 'struct' });
  });

  it('前置声明不算符号定义', () => {
    const { symbols } = parser.parse('struct pcb;\nvoid f(void);\n');
    expect(symbols).toHaveLength(0);
  });

  it('同名 static 函数在不同文件中各自独立提取', () => {
    const a = parser.parse('static void tick(void) {}\n');
    const b = parser.parse('static void tick(void) { other(); }\n');
    expect(a.symbols).toHaveLength(1);
    expect(b.symbols).toHaveLength(1);
  });

  it('条件编译产生两个同名结构体（ambiguous 场景的事实基础）', () => {
    const src =
      '#ifdef FAST\nstruct cfg { int fast; };\n#else\nstruct cfg { int slow; };\n#endif\n';
    const { symbols } = parser.parse(src);
    expect(symbols.filter((s) => s.name === 'cfg')).toHaveLength(2);
  });

  it('语法错误：hasErrors 标记，部分符号可能仍可提取但位置不可信', () => {
    const { hasErrors } = parser.parse('void broken( {;;;\n');
    expect(hasErrors).toBe(true);
  });

  it('空文件与纯注释不产生符号', () => {
    expect(parser.parse('').symbols).toEqual([]);
    expect(parser.parse('// nothing\n').symbols).toEqual([]);
  });

  it('ParserRegistry 按扩展名路由，未注册类型返回 undefined', () => {
    const registry = new ParserRegistry();
    expect(registry.byFilePath('a.ts')).toBeUndefined();
    registry.register(new CSourceParser());
    expect(registry.byFilePath('src/proc.c')?.languageId).toBe('c');
    expect(registry.byFilePath('include/proc.H')?.languageId).toBe('c'); // 大小写不敏感
    expect(registry.byFilePath('script.py')).toBeUndefined();
  });
});
