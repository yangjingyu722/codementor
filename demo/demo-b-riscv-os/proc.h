#ifndef PROC_H
#define PROC_H

#define NPROC 8

/* 进程状态：进程生命周期由这三个状态刻画（演示用途，未实现阻塞/唤醒）。 */
enum proc_state { UNUSED, READY, RUNNING };

/* 上下文：仅保存 callee-saved 寄存器（ra/sp/s0-s11 的简化子集）。 */
struct context {
    unsigned long ra;
    unsigned long sp;
    unsigned long s0;
    unsigned long s1;
    unsigned long s2;
};

/* PCB（进程控制块）：扁平结构体 + 固定数组。 */
struct pcb {
    int pid;
    enum proc_state state;
    struct context ctx;
};

void swtch(struct context *old, struct context *next);
struct pcb *scheduler(void);
int spawn(int priority);

#endif
