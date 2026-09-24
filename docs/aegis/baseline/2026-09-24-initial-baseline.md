# dsh-codex-sidebar Initial Baseline

Date: `2026-09-24`
Status: `initial dual-baseline snapshot`

## 1. Purpose

- 为「把 codex-cli 塞进 DSH 侧边栏并与 DSH 会话互通」这一工作建立第一份双基线，
  使后续 `Baseline Role Alignment` 能区分「需求基线错了」与「实现漂移了」。
- 本仓库在写这份基线时**还没有任何实现代码**，只有设计 spec 与工作区骨架。

## 2. Workspace Structure

```
docs/aegis/                     Aegis 工作区（本基线所在）
docs/aegis/specs/               设计 spec
docs/aegis/baseline/            基线快照（本文件）
src/                            （待建）host half + client half
```

- 宿主环境：DSH `0.1.5-rc.1`，web profile `~/.dsh/profiles/web`。
- 依赖生态（同机已装、被本插件消费）：
  - `dsh-better-sidebar@0.19.0`（侧栏页面注册服务 `ctx.betterSidebar`）
  - `dsh-bridge@0.1.0-rc.15`（`ctx.dshBridge.deliverExternal` 入站投递缝）
  - `dsh-auth-gate@0.12.0`（包装 webserver 全部路由/升级，只认证不做跨站防护）
- 外部依赖：codex-cli `0.156.1`（`~/.codex/config.toml` 为配置真相）。

## 3. Current Authority Surfaces

| surface | location | status |
| --- | --- | --- |
| 需求与设计 | `docs/aegis/specs/2026-09-24-codex-sidebar-design.md` | 已批准（用户 2026-09-24） |
| 侧栏扩展契约 | `dsh-better-sidebar/docs/external-plugin-guide.md` | 权威，实现期须复核 |
| codex 配置/CLI 语义 | codex-cli 0.156.1 实测（`--help` / `debug prompt-input` / `queue`） | 部分未文档化，属观测事实 |
| DSH 插件契约 | `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-*` + `vendor/deepseek-harness` | 权威 |

Authority gaps：codex 的 `queue_1.sqlite` 语义、TUI 状态行 UUID 稳定性均无官方文档，
只能作为观测事实并配降级路径。

## 4. Product / Requirement Baseline

### 4.1 Current Truth

- 需求来源：用户 2026-09-24 原话（见 spec §1）+ 四个澄清问答（spec §2.2）。
- 目标：侧栏 codex 页签；持久；聚焦优先吃键；与绑定 DSH 会话双向通信；注入 sidebar-codex 身份。
- 用户/场景：本机单用户，通过 web GUI（`127.0.0.1:9000`）使用；可能经 LAN 访问。
- 验收：spec §7 的 A1–A7（可观察）。
- 成功证据：A1–A7 全部实测通过，且刷新/切对话后进程未重启。

### 4.2 Non-negotiables

1. 不继承 DSH 会话上下文。
2. 不改 `dsh-better-sidebar` 本体、不改 codex 本体、不改 DSH 源码。
3. 不写用户 `~/.codex/config.toml`（只做 `-c` 覆盖）。
4. 不绕过 codex 的目录信任提示。
5. codex→DSH 投递走 dsh-bridge 的 `deliverExternal`（不另造投递 owner）。

### 4.3 Product Non-goals

- tmux 托管 / 远程 codex / 每对话多实例 / codex 历史浏览器 / 审批按钮代理（v1）。

## 5. Architecture / Runtime Boundary Baseline

### 5.1 Current Truth

- canonical owner：
  - 侧栏页面注册 = `dsh-better-sidebar` 的 client 服务（本插件只消费）。
  - 会话间投递 = `dsh-bridge`（本插件只调用）。
  - codex 进程与终端 = 本插件 `CodexInstanceRegistry`（唯一 owner）。
  - 会话工作目录真相 = DSH `sessions`/`sessionPersistence`（只读）。
- 契约/真相边界：codex 配置真相在 `~/.codex`；插件状态在内存（无持久化文件）。
- 依赖方向：本插件 → better-sidebar / dsh-bridge / DSH 核心；反向无依赖。

### 5.2 Architecture Non-negotiables

1. WS 升级必须自带 trust fence（Origin/Host 同源、拒 cross-site）。
2. codex 侧 MCP shim 走插件自有 127.0.0.1 + token 端点，不注册到 DSH webserver。
3. 任何解析失败（threadId / 就绪标记）必须降级到 pty 投递，不得静默丢消息。

### 5.3 Architecture Non-goals

- 不引入第二个 PTY/终端 owner；不复用 better-sidebar 的终端 WS 承载 codex。

## 6. Ownership / Contract Snapshot

| surface | owner |
| --- | --- |
| 侧栏 tab 注册 | `ctx.betterSidebar.registerTab`（better-sidebar） |
| codex 进程 / transcript | 本插件 |
| codex→DSH 消息投递 | `ctx.dshBridge.deliverExternal`（dsh-bridge） |
| DSH→codex 消息投递 | 本插件（`codex queue` 优先，pty 回退） |
| WS 围栏 | 本插件 `src/trust-fence.ts` |

## 7. Current State and Risks

- 当前阶段：设计已批准，实现未开始。
- 主要风险：codex CLI 未文档化行为漂移；better-sidebar 服务契约版本漂移；
  1:1 绑定在用户想给别的会话起 codex 时不支持（已列为非目标）。

## 8. Alignment Use

- 读 Product / Requirement Baseline：判断「行为/验收是否偏离用户确认的需求」。
- 读 Architecture / Runtime Boundary Baseline：判断「owner/契约/围栏是否被绕过」。
- `scope: both`：当变更同时触及用户可见行为与 owner/契约边界时。

## 9. Compatibility Boundary

- 不得破坏：DSH 0.1.5-rc.1 启动、better-sidebar 既有页签、dsh-bridge 既有语义、
  用户 `~/.codex` 配置与凭据。
- 跨版本升级（DSH / better-sidebar / codex）必须重跑 A1–A7。
