# dsh-codex-sidebar — Design Spec

Date: `2026-09-24`
Status: `approved (user, 2026-09-24)`
Kind: `design spec`
Owner repo: `CBalaa/dsh-codex-sidebar` (new), consumed as a submodule of `CBalaa/dsh-plugins`

## 1. Purpose

把 codex-cli 塞进 DSH 的右侧边栏，并让这个 codex 与它绑定的 DSH 会话双向通信。

用户原话（2026-09-24）:

> better side bar 提供的侧边栏 增加一个选项——codex，点开后会启动一个 codex（持久的 codex，不会因为网页关闭、切换对话而被关掉），
> 这个 codex 窗口与在终端里打开的 codex 窗口别无二致，当聚焦在 codex 窗口时，用户输入的快捷键优先被 codex 捕获并相应
> codex 绑定一个 dsh 对话，不继承 dsh 的上下文
> codex 和 dsh 可以通过插件进行交流（就像我们仓库里的 dsh-bridge 一样）
> 新开的 codex 会被注入上下文——说明它是一个 sidebar-codex、它可以通过插件和 dsh 交流

## 2. Product / Requirement Baseline

### 2.1 Requirement items

| id | requirement | acceptance |
| --- | --- | --- |
| R1 | 侧边栏出现一个 `Codex` 入口；点开在该 DSH 会话的工作目录启动 codex | A1 |
| R2 | 该 codex 与终端里的 codex 行为一致（继承 `~/.codex/config.toml`） | A1 |
| R3 | 持久：刷新页面、切换对话、关闭浏览器都不终止 codex | A2 |
| R4 | 关页签 = 摘挂（detach），重开接回同一 codex；另有显式「结束 codex」 | A2 |
| R5 | 聚焦 codex 时键盘输入（含快捷键）优先进入 codex | A5 |
| R6 | codex 与它绑定的 DSH 会话双向通信（对齐 dsh-bridge 语义） | A3, A4 |
| R7 | 新 codex 被注入身份上下文（sidebar-codex + 通信方式） | A3 |
| R8 | codex 不继承 DSH 会话的上下文 | design (no transcript seeding) |

### 2.2 Confirmed user decisions (2026-09-24)

| decision | chosen |
| --- | --- |
| 实例模型 | **每个 DSH 对话一个 codex（1:1）**；点开即启动，再点聚焦同一个 |
| 持久化边界 | **DSH 宿主托管 PTY**（刷新/切对话/关浏览器不丢；宿主重启或插件重载结束进程） |
| codex 自治姿态 | **完全继承 `~/.codex/config.toml`**（本机当前为 `approval_policy = 'never'` + `sandbox_mode = 'danger-full-access'`，即 YOLO） |
| 消息投递语义 | **自动注入绑定会话并唤醒 + 侧栏未读角标** |
| 关页签语义 | **摘挂（detach）**，不杀进程 |
| 仓库位置 | 新建 `CBalaa/dsh-codex-sidebar`，作为 submodule 收进 `CBalaa/dsh-plugins` |

### 2.3 Non-goals (v1)

- 不继承 DSH 会话上下文（不做 transcript seeding）。
- 不做 tmux 托管、不做跨机器/远程 codex。
- 不做每对话多实例（1:1 固定）。
- 不改 `dsh-better-sidebar` 本体、不改 codex 本体、不改 DSH 源码。
- 不做 codex 会话历史浏览器、不做审批按钮代理（审批仍在 TUI 里点）。
- DSH 侧工具在「本会话还没有 codex」时**不自动拉起** codex（拒绝并给出可读错误）。

## 3. Architecture / Runtime Boundary Baseline

### 3.1 Package shape

新包 `dsh-codex-sidebar`（host + client 双半），安装进 `~/.dsh/profiles/web`。

```
src/index.ts          host half: registry / spawn / ws / loopback api / tools
src/registry.ts       CodexInstanceRegistry（实例表 + 生命周期）
src/spawn.ts          codex argv/env 组装（注入 developer_instructions + mcp_servers.dsh）
src/deliver.ts        dsh→codex 投递策略（queue 优先，pty 回退，就绪门）
src/loopback.ts       127.0.0.1 + per-instance token 的本地 HTTP 端点
src/mcp-shim.ts       codex 侧 MCP stdio server（独立入口 lib/codex-mcp.js）
src/trust-fence.ts    WS 升级的 Origin/Host 同源围栏
src/tools.ts          DSH 工具：codex_send / codex_read / codex_status / codex_restart
src/client/index.tsx  client half: registerTab + CodexView
```

### 3.2 Canonical owners (no duplicate owners)

| surface | owner | rule |
| --- | --- | --- |
| 侧栏页面注册 | `dsh-better-sidebar` 的 client 服务 `ctx.betterSidebar` | 我们只**消费** `registerTab`，不自绘侧栏、不改它 |
| DSH 会话间投递 | `dsh-bridge` 的 `ctx.dshBridge.deliverExternal()` | codex→DSH 一律走它；仅当 dsh-bridge 缺席时降级为 `agent.followup()` 并记日志 |
| codex 进程与终端 | 本插件（`CodexInstanceRegistry`） | 全进程唯一 owner；better-sidebar 的终端 PTY 表不参与 |
| DSH 会话/工作目录真相 | DSH `sessions` / `sessionPersistence` | 只读；不落第二份 cwd 真相 |
| codex 配置真相 | `~/.codex/config.toml` | 只读继承；插件只做 `-c` 覆盖，**不写**用户配置文件 |

### 3.3 Data flow

```
浏览器 ──WS /codex-sidebar/ws──▶ 插件 host ──node-pty──▶ codex TUI
   ▲                                  │                     │
   └──── transcript 回放 / 未读角标 ────┘                     │ MCP stdio
                                                            ▼
DSH agent ──codex_send──▶ 投递策略 ──①codex queue / ②pty 写入──▶ codex
DSH agent ◀──deliverExternal── 插件 loopback HTTP ◀── mcp__dsh__send_message ── codex
```

## 4. Contracts

### 4.1 Sidebar tab registration (client half)

```ts
export const inject = ['betterSidebar']   // 防御性探测 ctx.get('betterSidebar')
ctx.effect(() => ctx.betterSidebar.registerTab({
  id: 'codex-sidebar:codex',
  title: () => 'Codex',
  icon: <CodexIcon />,
  description: '在侧栏里跑一个持久 codex，并与本对话互通消息',
  order: 45,
  single: true,
  badge: (ctx, scope, state) => unreadCount(scope.sessionId) || undefined,
  component: (props) => <CodexView {...props} />,
}))
```
- 类型通过 `import type {} from 'dsh-better-sidebar/client/service'` 合并（纯浏览器侧路径，零 Node 类型依赖）。
- 注册必须包在 `ctx.effect(...)` 内（HMR/禁用时自动撤销，避免 "already registered"）。
- 注册后由 better-sidebar 自动进入 DSH 原生右侧栏的 `+` guide。
- 已按 `docs/external-plugin-guide.md` §4 核实：`id` 同时是 tab 的 `type`；`single: true` ≡ `dedupeKey: () => id`（打开时聚焦既有 tab），**不需要** `createTab`（缺省即铸造 `{id, type, title}`）。
- `badge` 每次 tab 栏渲染都会调用 → 必须廉价（只读本地计数、不发请求）；抛错会被吞掉。
- `description` 只在 guide 条目 ≤ 4 条时渲染（内置已 6 条）→ 不承载关键信息。

### 4.2 Terminal WebSocket

- 路径：`/codex-sidebar/ws?sessionId=<id>&instance=<instanceId>`
- 围栏（**必须先于** WS 握手）：Host 为 loopback 或 DSH 已信任 authority；拒绝 `sec-fetch-site: cross-site`；`Origin` 主机名必须与 `Host` 一致。理由：`dsh-auth-gate` 只做认证、不做 DNS-rebinding/跨站防护，LAN 暴露下缺 Origin 校验可被跨站 WebSocket 劫持拿到 codex 终端。
- 客户端 → 服务端：原始字符串 = 键盘输入；JSON 控制帧 `{type:'resize',cols,rows}` / `{type:'park'}` / `{type:'close'}`。
- 服务端 → 客户端：原始 pty 输出；进程退出追加 `\r\n[codex exited with code N]\r\n`。
- 生命周期语义（与 better-sidebar 终端对齐）：
  - 连接时先回放 `transcript`（上限 1 MiB 环形），再转发实时输出。
  - 裸断线（刷新/崩溃）：`reconnectGraceMs`（默认 30s）后关闭；期间重连 `open()` 取消关闭。
  - `park`（切到别的对话、页签仍开）：无限期保活，不启动关闭倒计时。
  - `close`（用户关页签）：**detach** —— 只断开视图并保留进程（与 better-sidebar 终端「关页签即 kill」不同，见 §2.2 决策）。
  - 插件卸载 / 宿主重启：`disposeAll()` 结束全部 codex 进程。

### 4.3 codex spawn

```
argv: codex
  -c developer_instructions="<injected identity context>"
  -c mcp_servers.dsh.command="<process.execPath>"
  -c mcp_servers.dsh.args=["<pluginDir>/lib/codex-mcp.js"]
  -c mcp_servers.dsh.env={ DSH_CODEX_URL, DSH_CODEX_TOKEN, DSH_CODEX_INSTANCE, DSH_CODEX_SESSION }
env : { ...process.env, TERM: 'xterm-256color' }   // codex 对 TERM=dumb 硬拒绝
cwd : 该 DSH 会话的工作目录（host 侧从 sessions/sessionPersistence 解析）
pty : node-pty, name 'xterm-256color', cols/rows 由客户端首帧给出
```

- 不设置 `CODEX_HOME` → 继承用户 `~/.codex`（含 `auth.json`、`config.toml`、`projects.*` 信任表）。
- 若用户 `config.toml` 将来含 `developer_instructions`，插件读取其值并以 `"<ours>\n\n<theirs>"` 追加，避免覆盖。
- 沙箱/审批一律不覆盖（见 §2.2）。

### 4.4 Injected identity context (developer_instructions)

固定文本（英文，模型面契约；改动需同步单测）：

```
You are running as a "sidebar-codex" inside DeepSeek Harness (DSH).
- Bound DSH session: <sessionId>; working directory: <cwd>. You do NOT share that
  conversation's context; it never sees your transcript unless you send it.
- You can talk to DSH through the MCP server `dsh`:
  `mcp__dsh__send_message` (deliver text to the bound DSH session; it wakes that agent),
  `mcp__dsh__read_messages` (read messages DSH sent to you),
  `mcp__dsh__status` (bound session id/title/cwd).
- Messages from DSH arrive as user messages prefixed `[codex-sidebar <instanceId>]`.
- Prefer answering the user in this TUI; use `send_message` when DSH needs the result.
```

### 4.5 DSH tools

| tool | input | behavior |
| --- | --- | --- |
| `codex_send` | `text` | 投递到本会话绑定的 codex（§4.6 策略）；无实例 → 可读错误 |
| `codex_read` | `limit?` | 返回 codex→DSH 的收件箱消息（本会话） |
| `codex_status` | — | 实例状态：running/exited、threadId、cwd、最近输出尾部（截断） |
| `codex_restart` | — | 进程已退出时用相同参数重启（接回同一实例 id） |

### 4.6 dsh → codex delivery strategy

```
1) threadId 已知且该线程已有 rollout → spawn `codex queue --thread <threadId> --message <text>`
   （实测：能注入正在运行的 TUI 并触发一轮；写 $CODEX_HOME/queue_1.sqlite）
2) 否则 → pty 写入：bracketed paste 包裹正文 + `\r`，必要时补发回车
   - 就绪门：屏幕尾部命中 `Trust this folder?` / 审批提示 / 其它模态标记 → 暂不投递，
     消息留在待发队列，UI 显示「等你确认」
3) 两条路径都失败 → 工具返回失败原因，绝不静默丢弃
```

`threadId` 来源：codex TUI 状态行里的 UUIDv7（首个匹配），解析失败则维持 pty 路径。

### 4.7 codex → DSH delivery

MCP shim（codex 子进程）→ `POST <DSH_CODEX_URL>/message`（Bearer `DSH_CODEX_TOKEN`）→ 插件校验 token 与实例 → `ctx.dshBridge.deliverExternal(from='codex:<instanceId>', to=<sessionId>, text, {transport:'codex'})`。

- 消息正文不加自定义前缀：dsh-bridge 自己生成 `[dsh-bridge codex message <id> from codex:<instanceId>]` 信封（来源在 `from` 字段，模型可辨）。只有走降级路径（dsh-bridge 缺席、直接 `agent.followup`）时才加 `[codex-sidebar <instanceId>]` 前缀，保证模型仍知道来源。
- 投递失败（会话归档/不存在）：MCP 工具返回错误文本给 codex，同时侧栏标红。

### 4.8 Loopback endpoint

- `http.createServer()` 绑定 `127.0.0.1`，端口 0（OS 分配），仅本插件使用。
- 每实例一个 32 字节随机 token（`crypto.randomBytes`），经 spawn env 传给 shim；每个请求校验 `Authorization: Bearer <token>`，失败 401。
- 路由：`POST /message`（codex→DSH）、`GET /inbox?limit=`（DSH→codex 的待读消息）、`GET /status`。
- 不注册到 DSH webserver：`dsh-auth-gate` 会包装 webserver 上所有路由/升级，无头 shim 无法通过其认证。

## 5. Failure / recovery

| 场景 | 行为 |
| --- | --- |
| codex 未安装 / 不在 PATH | 页签显示可读错误 + 修复提示；不重试风暴 |
| 新目录首次运行触发 `Trust this folder?` | 不注入消息；UI 提示「codex 等你确认目录信任」 |
| codex 进程退出（/quit、崩溃） | 页签保留 transcript + `[codex exited with code N]` + 「重启」按钮 |
| 会话 cwd 解析失败 | 用 DSH 进程 cwd 兜底并在 UI 标注 |
| WS 连续 3 次无理由关闭 | 显示错误横幅 + 手动重连（不自旋重试） |
| dsh-bridge 缺席 | codex→DSH 降级为 `agent.followup()`，日志 WARN |
| 目标会话已归档 | 投递被拒，错误回传 codex |

## 6. Security

1. WS 升级自建 trust fence（§4.2）——这是插件自己的责任，auth-gate 不提供。
2. loopback HTTP 只绑 127.0.0.1 + per-instance token；token 只经进程 env 传递，不落盘、不进 URL。
3. 继承用户 codex 配置即继承其 `approval_policy`/`sandbox_mode`（本机为 YOLO）——**显式记录，不静默修改**。
4. 不绕过 codex 的目录信任提示。
5. 注入的 `developer_instructions` 只含身份与通信说明，不含用户仓库内容。

## 7. Acceptance criteria (observable)

| id | criterion | how verified |
| --- | --- | --- |
| A1 | 侧栏 `+` 菜单出现 Codex；点开在该会话 cwd 起 codex，TUI 可交互（打字/Ctrl+C/方向键/粘贴） | 手动：本地 web GUI 实测 |
| A2 | 刷新页面后是同一个 codex（transcript 回放、进程未重启）；切对话再回同一进程；关页签再开接回同一个 | 手动 + host 侧实例表断言（pid/instanceId 不变） |
| A3 | 问 codex「你是谁」→ 它知道自己是 sidebar-codex，并能 `mcp__dsh__send_message` 回传；DSH 侧被唤醒、角标清零 | 手动端到端 |
| A4 | DSH 侧 `codex_send("...")` → codex TUI 出现该消息并开始处理 | 手动端到端 + 单测（策略选择/就绪门） |
| A5 | 聚焦 codex 时键盘输入与快捷键进入 codex，DSH 不抢键 | 手动 |
| A6 | codex 退出后页签显示已退出 + 一键重启 | 手动 |
| A7 | 跨站 WS 握手被围栏拒绝（伪造 Origin） | 单测 + curl 探测 |

## 8. Verification commands

```
pnpm install
pnpm run build          # tsc(host) + tsdown(client bundle)
pnpm run typecheck
pnpm test               # vitest: 投递策略 / 就绪门 / 围栏 / threadId 解析 / argv 组装
```

手动验收：装进 `~/.dsh/profiles/web` → 起 web GUI → 按 A1..A7 走一遍。

## 9. Risks and mitigations

| risk | mitigation |
| --- | --- |
| codex TUI/`queue` 属未文档化行为，随版本漂移 | 解析失败一律降级到 pty 投递；投递策略为可替换单元；版本记录在 README |
| `codex queue` 依赖 `~/.codex/queue_1.sqlite` 语义 | 只在 threadId+rollout 已知时使用；失败即回退 |
| transcript 1 MiB 上限导致长会话头部丢失 | 与 better-sidebar 终端一致；文档标注 |
| better-sidebar 服务版本漂移（`features` 列表） | 用 `features` 做能力门控，缺失即降级（不注册 tab 并报错） |
| 1:1 绑定下用户想给别的会话起 codex | v1 明确不支持；非目标已记录 |

## 10. ADR signals

- **ADR-1（owner）**：codex→DSH 投递的唯一 owner 是 `dsh-bridge.deliverExternal`，本插件不得自建第二条投递路径（降级路径需显式标记并记录）。
- **ADR-2（compat）**：依赖 `dsh-better-sidebar` 的 client 服务契约（`registerTab` + `features`），跨版本升级需按其 guide 复核。
- **ADR-3（contract）**：注入文本与消息前缀（`[codex-sidebar <id>]`）是模型面契约，改动需同步单测与 README。
- 三条 ADR 在实现落地后补写正式 ADR（`docs/aegis/adr/`），本 spec 只登记信号。

## 11. Open items (non-blocking)

- `codex queue` 在多实例并发下的时序（同 CODEX_HOME 共享 queue 表）——实现期观测。
- 是否提供「自动拉起 codex」设置开关——v1 不做，留待使用反馈。
