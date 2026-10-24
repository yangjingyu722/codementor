# Demo B：简化 RISC-V OS 进程调度（学习功能展示）

展示 CodeMentor 工程认知学习功能的示例工程，涉及四个核心概念：

| 概念              | 位置                                                  |
| ----------------- | ----------------------------------------------------- |
| PCB（进程控制块） | `proc.h` 的 `struct pcb`                              |
| 进程状态          | `proc.h` 的 `enum proc_state`（UNUSED/READY/RUNNING） |
| 调度器            | `proc.c` 的 `scheduler`（轮询）                       |
| 上下文切换        | `swtch.c` 的 `swtch`（callee-saved 寄存器保存）       |

## 诚实边界（必读）

- 这是一个**用于展示 CodeMentor 学习流程的简化 C 模型**，不是可运行的操作系统内核。
- `swtch` 在真实内核中是汇编（保存/恢复真实寄存器）；这里用 C 等价表达寄存器组语义。
- **未实现**：中断、阻塞/唤醒、时间片、页表、特权级切换。本 Demo 未做 QEMU 或交叉编译工具链验证（如需系统级验证需自行准备 riscv64 工具链与 QEMU，CodeMentor 不依赖它们工作）。
- CodeMentor 对它的全部价值在于：把"为什么这样设计"与这些真实文件关联起来，并生成学习流程。

配合 [docs/DEMOS.md](../../docs/DEMOS.md) 与 `demo/seed-demo.mjs` 使用。
