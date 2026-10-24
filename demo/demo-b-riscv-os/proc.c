#include "proc.h"

static struct pcb ptable[NPROC];
static struct pcb *current;

/* 轮询调度器：线性扫描就绪进程（进程数 ≤ NPROC 时常数更小）。 */
struct pcb *scheduler(void) {
    for (;;) {
        for (int i = 0; i < NPROC; i++) {
            if (ptable[i].state == READY) {
                current = &ptable[i];
                ptable[i].state = RUNNING;
                return current;
            }
        }
    }
}

/* 分配 PCB：找 UNUSED 槽位，置 READY 后由调度器接管。 */
int spawn(int priority) {
    for (int i = 0; i < NPROC; i++) {
        if (ptable[i].state == UNUSED) {
            ptable[i].pid = i + 1;
            ptable[i].state = READY;
            ptable[i].ctx.s0 = (unsigned long)priority;
            return ptable[i].pid;
        }
    }
    return -1;
}
