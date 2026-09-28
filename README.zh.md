# dsh-codex-sidebar

[English](README.md) | 简体中文

> 把 codex-cli 塞进 DSH 右侧边栏：一个**持久**的 codex TUI，与当前对话 1:1 绑定，
> 并通过插件与 DSH 双向通信。

## 它做什么

- 在 DSH 原生右侧栏的 `+` 菜单里增加 **Codex** 条目。点开就在该对话的工作目录里启动一个
  真实的 `codex` TUI —— 与你在终端里跑的 codex **行为一致**，因为它原样继承你的
  `~/.codex/config.toml`（审批策略、沙箱模式、模型、项目信任表、MCP server、hooks 全都不动）。
- codex 进程是**持久**的：

  | 事件 | codex 会怎样 |
  | --- | --- |
  | 刷新页面 / 关浏览器 | 继续跑；重连时回放 transcript（断线 30s 宽限期） |
  | 切到别的对话再切回来 | 继续跑（parked，无超时） |
  | 关闭 Codex 页签 | 继续跑（页签只是**摘挂**）；重开接回同一进程 |
  | 工具栏 → *结束 codex* | 进程被结束（显式动作） |
  | DSH 宿主重启 / 插件重载 | 随宿主一起结束 |

- **焦点优先**：页签不安装任何按键拦截，聚焦在 codex 终端时，打字、方向键、Ctrl+C、
  粘贴全部直接进入 codex。
- **双向通信**：
  - codex → DSH：通过 MCP server `dsh`（`mcp__dsh__send_message` /
    `mcp__dsh__read_messages` / `mcp__dsh__status`）。消息经 `dsh-bridge` 的入站缝投递进
    绑定对话，并唤醒 DSH agent。
  - DSH → codex：通过 `codex_send` 工具。
- **身份注入**：每个新起的 sidebar codex 都会被告知自己是 "sidebar-codex"、绑定在哪个
  DSH 会话上、以及怎么联系它。

## 工具

| 工具 | 方向 | 说明 |
| --- | --- | --- |
| `codex_send` | DSH → codex | 已知线程时走 `codex queue`，否则走带就绪门的 pty 粘贴 |
| `codex_read` | DSH ← codex | 重读 codex 发给本对话的消息 |
| `codex_status` | — | 进程状态、codex 线程 id、工作目录、未读数、终端尾部 |
| `codex_restart` | — | 用同一套注入重启已退出的 codex |

## 安装

```bash
pnpm install && pnpm run build
dsh plugin --profile web add file:/path/to/dsh-codex-sidebar
```

`node-pty` 只为 macOS/Windows 提供预编译产物，Linux 上必须由安装脚本编译原生模块，
因此 `pnpm-workspace.yaml` 放行该构建（`allowBuilds: node-pty: true`）。

## 两个通道怎么工作

```
浏览器 ──WS /codex-sidebar/ws──▶ 插件 host ──node-pty──▶ codex TUI
   ▲                                │                     │
   └──── transcript 回放 / 角标 ─────┘                     │ MCP stdio
                                                          ▼
DSH agent ──codex_send──▶ 投递策略 ──①codex queue / ②pty 粘贴──▶ codex
DSH agent ◀──deliverExternal── 插件回环端点 ◀── mcp__dsh__send_message ── codex
```

**DSH → codex**（`src/deliver.ts`）
1. 已知 codex 自己的线程 id 时优先 `codex queue --thread <id> --message <text>`
   （线程 id 从 TUI 状态行或 rollout 文件名里发现）。`queue` 需要已存在的 rollout，
   所以首轮之前不可用。
2. 否则走 pty 的 bracketed paste —— 但必须满足：输入框空闲 **且** 粘贴被回显。
   codex 会**先画出输入框**、之后才用弹窗（目录信任 / 审批）清屏，而弹窗会吞掉粘贴，
   所以回车只在看到回显后才发。被吞掉时消息留在待发队列并给出可读原因
   （`codex is waiting for you (…)`）。
3. 两条路都不通就**响亮失败**，绝不静默丢弃。

**codex → DSH**（`src/loopback.ts`、`src/mcp-shim.ts`、`src/to-dsh.ts`）
codex 启动的 MCP shim 调用插件自有的回环端点（只绑 `127.0.0.1`、OS 分配端口、每实例
32 字节 token 经进程环境传入），再转发给 `ctx.dshBridge.deliverExternal(...)`。
dsh-bridge 缺席时插件打 WARN 并降级为直接 `agent.followup`（无审计记录）——是显式降级，
不是第二条消息总线 owner。

## 安全

- `/codex-sidebar/ws` 与 `/codex-sidebar/api/*` 带插件自建的围栏：拒绝
  `Sec-Fetch-Site: cross-site`、`Origin` 必须与 `Host` 同主机、Host 必须是 loopback
  或 DSH 已信任的 authority。`dsh-auth-gate` 只做认证、不做跨站 WebSocket 劫持防护，
  所以这道围栏不是可选项。
- 回环端点只绑 `127.0.0.1`，每实例一个 token；token 只走进程环境，不进 argv、不落盘。
- codex 进程继承**你的** `~/.codex/config.toml`，包括你自己设的 `approval_policy` /
  `sandbox_mode`（本机当前是 `never` + `danger-full-access`，即 YOLO）。插件从不覆盖它们。
- 不绕过 codex 的目录信任提示：未信任的目录会一直等你在侧栏里确认。

## 已知边界

- transcript 回放上限 1 MiB（与 better-sidebar 终端一致），超长会话会丢头部。
- `codex queue` 属上游未文档化行为；它变了就自动回退到 pty 路径。
- 就绪标记是对 codex TUI 文案的启发式判断。判断失败只会让消息留在待发队列，
  绝不会往弹窗里打字。
- 没有 tmux 持久化：DSH 宿主重启会结束 codex 进程（2026-09-24 经你确认的设计）。

## 实测环境

| 组件 | 版本 |
| --- | --- |
| DSH | 0.1.5-rc.1 |
| dsh-better-sidebar | 0.19.0 |
| dsh-bridge | 0.1.0-rc.15 |
| codex-cli | 0.156.1 |
| node-pty | 1.1.0 |

## 开发

```bash
pnpm run typecheck     # tsc --noEmit
pnpm test              # 46 个单测（围栏 / argv / 就绪门 / 投递 / 线程 id / 工具 / bundle）
DSH_CODEX_SMOKE=1 pnpm vitest run tests/pty-smoke.spec.ts tests/bridge-smoke.spec.ts
                       # 实时烟测：真实 codex TUI 跑在我们的 pty 里；shim → 回环 → 投递
```

设计与计划在 `docs/aegis/`：

- `specs/2026-09-24-codex-sidebar-design.md` —— 已批准设计、契约、验收标准
- `plans/2026-09-24-codex-sidebar-implementation.md` —— 逐任务实现计划
- `baseline/2026-09-24-initial-baseline.md` —— owner / 需求基线
