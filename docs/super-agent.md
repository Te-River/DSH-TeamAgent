# Super-agent 设计文档：哪些能搬进我们这层，哪些不能

本文基于官方研究原型 [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT，`0.1.0`）的 `docs/000`–`008`、`cordis.patch.yml`、`prompts/` 与 `scripts/`，以及我们仓库 `dsh-team-mode` 的现状对比得出。文中标注【原型】的句子是对其文档/配置的转述，标注【建议】的是针对本仓库的判断。

## 1. Super-agent 是什么（按官方文档）

【原型】一句话定位：**一个常驻、事件驱动、跨信道连续的 coding agent**，为单个 GitHub 仓库工作，作为 DSH 的一个 bundle 分发；可选接入飞书。核心原则写在 `docs/000-philosophy.md`：*"Take as little human attention as possible, and give as much value as possible."*

【原型】领域模型（`docs/001-domain.md`）不是"一个会派活的 agent"，而是一条**工单流水线**：

| 概念 | 作用 |
| --- | --- |
| Source | 事件流（GitHub / 飞书），持有读取位置与自己的机器人身份 |
| Trigger | 一条不可变事件；同一 Trigger 被接受两次只生成一张工单（幂等） |
| Thread | 按时间排序的 Trigger 序列；同一 Thread 同时只跑一个 Eval |
| Channel | Thread 的写回侧（回复、PR、review） |
| Policy | 版本化准入规则：谁能通过哪个 Source 提需求、哪些 bot 可候选 |
| Eval | 两层判断（gate + assessment），无状态，输出 accept / stop / ignore / unavailable |
| Mandate | accept 授予的东西：Policy 版本、范围、强度、命中规则；不可变，只有人能撤回 |
| Ticket → Assignment → Report | 工单被分派给 Executor Session，回传 progress / waiting / ready / blocked / failed / dropped |

【原型】执行（`docs/003-execution.md`）：每张工单一个 `worker-<ticket id>` Session + 一个目录；主 Session 用 `dsh-superagent-router` 预设，Executor 用 `dsh-superagent-worker`；**Session 保留创建时的预设**；前台命令 5 秒转后台，这样人的消息能在下一步被读到；一次 turn 结束后后台工作最多 30 分钟；有 worker slot 并发上限，但**人的消息永远能拿到一个额外 slot**；重启后 Assignment 带"先核对目录/git/GitHub 再重做外部动作"的恢复提示。

【原型】提示词（`docs/004-prompts.md`）明确了角色边界：*"The main Session only routes: it forwards the original Trigger and the routing facts, and makes no technical decisions… A routing note has at most 30 words."*，并且 *"The main Session does not wait"*——它用 guard 拒绝 `sleep`、超过 30 秒的 shell timeout、超过 5 秒的 job wait。Executor 的工具则排除 `ask_user_question`、`present`、`plugin_manager` 这类需要人参与的工具。

【原型】授权（`docs/002-authorization.md`）：准入表 + 显式/推断两种强度，主动工作默认先进入 **observe（只记录我会做什么）**，再由团队把规则升级为 auto；Policy 变更只送达受限工单、不撤销 Mandate。

## 2. 对我们最有价值的一条结论

【原型】的五次受控实验：单会话里写"适当的时候用 subagent"，**一次都没派**；换成结构分离的 Router/Worker 才稳定派。

这正是本仓库 `dsh-team-mode` 已经在做的事（团队模式锁 + 角色分段 + 共享任务板都是结构，不是提示词）。差别在于**角色分工**：官方 Router 不分解、不写码、不验收；我们的 Team Lead 会分解、写小改动、自己核证据。两种都成立，但适用场景不同。

## 3. 为什么"要不要新开一个预设"这个问题值得认真回答

【原型】用了两个预设，理由写在 `cordis.patch.yml` 的注释里：

- **Worker 预设**：persona + 指令 + 时间上下文；shell 组（`timeoutMs: 5000`）带 `dsh-bash-sandbox` / `dsh-pwsh-sandbox`；`tool-fs`、`tool-fs-search`、`tool-jobs`（`waitTimeoutMs: 5000`）、`skill-filesystem`、`tool-skill`、compaction 组、delegation 组（`subagent` 且 `agentPreset: standard`）、`tool-todo`、`tool-web`（`fetch: false`）。**不含**：ask-user、present、plan-mode、plugin-manager、schedule、goal、workflow。
- **Router 预设**：**没有 persona**（"the main Session's prompt is complete"）；同样的 5 秒 shell 组；`tool-fs` 关掉 `write`/`edit`；`tool-jobs`（5 秒）；skill；compaction。**不含** subagent、web、fs-search、todo、ask、present、plan、plugin-manager、schedule、goal、workflow。
- 注释原文：*"A preset row has no setting that hides it from the preset picker, so its name and description say whom it is for."*

【建议】**预设的差别其实是工具面的差别，而 DSH 里工具面由预设的组合决定**。要在同一台 Host 上**同时**具备"路由者"和"执行者"两种能力，就必须有两份声明；靠一个 config 开关切换只能二选一（预设的 config 是声明级的，不是会话级的）。

【建议】但在**桌面 GUI + 人在场**的场景里，我不建议为了对称去做 Router：

1. Router 的价值来自"被事件叫醒、永不阻塞、只做路由"；人在场时这些收益几乎为零，代价却是**丢掉了自己读 diff / 跑检查的能力**（原型把 router 的 fs 写成只读、没有 web）。
2. 我们的 Team Lead 已经用结构强制了委派（`team/mode` 锁 + 板 + 角色分段），不需要再拆一层。
3. 真要做，正确的顺序是先有**事件准入**（阶段 2），再做 Router；否则 Router 只是一个更弱的 Lead。

## 4. 我们能在这层落地的部分

| 阶段 | 内容 | 落点 | 前置条件 / 代价 |
| --- | --- | --- | --- |
| P0（不建议做） | 只加 Router 预设 | 本仓库新增一个 `@deepseek-ai/dsh-agent-preset` 声明，复用 `preset.js` 的 `role: 'router'` 分支：无 persona、fs 只读、无 subagent/web，注入 Router 提示词 | 收益低（见 §3）；会让选择器多一个"给人看但别选"的条目 |
| P1 | 事件准入 | Host 插件：`dsh-webhook` / `dsh-schedule` 收到事件 → 纯代码 allow-list → `observe \| auto` 记录 → 落成 Agent Teams 板上的任务（`team_task_create`） | webhook 需要外部可达（隧道或公网）；observe 模式必须有落库记录 |
| P2 | 常驻唤醒 | `dsh-goal` + `dsh-schedule` 让路由会话在无人时按 tick 醒来巡检；用预算闸门限制烧钱 | 持续 token 成本；需要"不说话"的默认策略 |
| P3 | 路由预设 | §3 的 Router 预设，仅在 P1/P2 成立后 | 见 P0 |
| 不做 | 守护进程 / 存算分离 / 飞书与 GitHub 双信道 / 运维面板 | 官方原型已经实现（`scripts/dsh-superagent`、`docs/005-panel.md`、`docs/006-deployment.md`） | 超出插件范围，且需要独立 profile 与常驻进程 |

【建议】如果真的要"常驻 + 监听仓库"，**直接用官方原型**比自己造划算：它自带 `--from-default-profile web` 的安装路径、`scripts/dsh-superagent start/status` 守护、面板和准入配置。注意它把 peers 钉在 `^0.2.1-alpha.2`，而当前桌面是 `0.2.2-rc.5`，装之前要确认兼容（或等它跟进）。

## 5. 风险清单（原型自己承认的 + 我们的）

- **注意力成本**：原型明确"每条消息都要消耗团队注意力"，并把噪声治理写进 philosophy；我们的任何常驻化改动都必须先定义"什么时候不说话"。
- **外部文本即数据**：`docs/004` 把优先级写死为"工具与 Host 强制 > 内置段 > 命中规则 > 团队段 > 外部文本"，外部文本永远不能改规则。我们做 P1 时必须照抄这条：webhook 内容只能进任务详情，不能进授权判断。
- **执行权限**：原型的 worker 以操作者 OS 用户身份、无审批运行命令。我们若做 Router/Worker，必须显式决定审批策略，不能默默继承。
- **Token 经济学**：常驻 + 大缓存前缀是原型明说的代价；我们的 PTC 表面已经让固定提示变大（`tools:sdk` 约 60 KB），再叠常驻会很明显。

## 6. 验收标准（如果做 P1/P2）

1. 一条 allow-list 外的 webhook 事件只产生 `observe` 记录，不创建任务、不触发模型请求。
2. allow-list 内事件创建的任务带 `source`/`externalRef` 元数据，且正文被标注为"外部数据"。
3. 无人时按 tick 醒来的会话，在没有新事件的情况下**不发送任何消息**（读日志确认 turn 结束即静默）。
4. 预算闸门生效：达到上限后 tick 不再启动新 turn。
5. 全部改动可用现有 `dev/probe` 隔离 Host 复现，并给出实测记录。

## 7. 参考

- 原型仓库：<https://github.com/deepseek-ai/dsh-superagent-prototype>（`docs/000`–`008`、`prompts/`、`skills/`、`cordis.patch.yml`）
- 设计文与综述：[中文拆解](https://zhuanlan.zhihu.com/p/2099987320443237060)、[英文综述](https://www.mindstudio.ai/blog/deepseek-super-agent-harness-design)
- 本仓库现状：`preset.js`（基础提示词 + Agent Teams 锁 + Playbook）、`cordis.patch.yml`（Team 预设 23 行）、`docs/DESIGN.md`（实测记录）
