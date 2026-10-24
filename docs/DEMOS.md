# Demo 操作指南

两个示例工程覆盖两类验证目标：**Demo A 验证基础部署与稳定性**；**Demo B 展示工程认知学习功能**。

通用前置（一次性）：

```bash
pnpm install && pnpm build
pnpm --filter @codementor/server start     # 终端 1：保持运行
code --install-extension apps/vscode/dist/codementor-0.1.0.vsix
```

然后（终端 2）：

```bash
node demo/seed-demo.mjs
```

> 脚本幂等：重复执行不会产生重复项目（rootPath 唯一注册）。

## Demo A：简单 C 工程（基础部署验证）

目标：验证"解析 → 注册 → 树展示 → 锚点 → 学习"的最小链路在一个普通 C 工程上工作。

1. 用 VS Code 打开 `demo/demo-a-simple-c`；
2. 侧栏 CodeMentor → 任务「实现应用配置模块」→ 决策「启动时全量校验配置」；
3. 详情页确认：问题 / 备选（惰性校验）/ 最终选择（fail-fast 校验）/ 事前声明理由；
4. 打开 `app_config.c`：`validate_config` 上方出现 CodeLens，点击回到决策；
5. 详情页学习区 → 开始学习 → 完成三步。

## Demo B：简化 RISC-V OS 进程调度（学习功能展示）

目标：在涉及 PCB / 进程状态 / 调度器 / 上下文切换的真实设计记录上，走完
**问题 → 方案判断 → 解释 → 代码验证 → 独立练习** 的完整学习流程。

1. 用 VS Code 打开 `demo/demo-b-riscv-os`；
2. 侧栏选择任务「实现上下文切换」→ 决策「上下文切换采用 callee-saved 策略」；
3. 查看设计问题与备选方案（全量寄存器保存 vs 仅 callee-saved）；
4. 点击学习区"开始学习"：
   - **方案判断**：先凭直觉选——错了也会得到引用真实取舍的反馈；
   - **查看解释**：解释区逐句引用该决策编码前声明的主张；
   - **代码验证**：按提示定位 `swtch`（Level 1 提示直接给出 `swtch.c`），也可点"查看代码证据"直接跳转；
   - **独立练习**：合上代码解释"为什么只保存部分寄存器"，系统按真实记录核对要点；
5. 打开 `proc.c` / `swtch.c` 观察 CodeLens 与状态图标。

## 演示"变更 → 重定位 → 失效"

在 Demo B 文件夹中修改源码后：

```bash
# 例：在 swtch.c 顶部加两行注释（行号漂移）
# 然后在 VS Code 中：CodeMentor 树标题栏 → "重新验证锚点"
```

- 漂移 → 锚点自动重定位（confirmed，行号更新）；
- 删除符号 → 锚点标记"已失效"（missing，保留最后已知位置，绝不静默清除）；
- 在 `#ifdef` 中制造同名双定义 → 标记"无法精确定位"（ambiguous）。

## 诚实边界

- Demo B 是**展示学习流程的简化 C 模型**：`swtch` 的真实内核实现是汇编；未实现中断、
  阻塞/唤醒、时间片、页表；未做 QEMU/交叉编译验证（CodeMentor 不依赖它们）。
- 两个 Demo 均无需编译即可被 CodeMentor 解析（tree-sitter 直接读源码文本）。
