/* RISC-V 上下文切换（简化 C 表达）。
 *
 * 设计决策：只保存 callee-saved 寄存器（ra/sp/s0-s11）。
 * 依据：RISC-V 调用约定下 caller-saved 寄存器由编译器在调用点保存，
 * 内核无需重复保存。真实内核中本函数为汇编（swtch.S），
 * 这里用 C 等价模型展示寄存器组的保存/恢复语义。 */
void swtch(struct context *old, struct context *next) {
    old->ra = 0; old->sp = 0; old->s0 = 0; old->s1 = 0; old->s2 = 0;
    next->ra = 0; next->sp = 0; next->s0 = 0; next->s1 = 0; next->s2 = 0;
}
