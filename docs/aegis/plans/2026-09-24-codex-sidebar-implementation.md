# dsh-codex-sidebar — Implementation Plan

Goal: 在 DSH 右侧边栏提供 `Codex` 页签，托管一个**持久**的 codex-cli TUI（host 侧 node-pty），
与该 DSH 会话 1:1 绑定，并与 DSH agent 双向通信（codex→DSH 走 dsh-bridge 的入站缝，
DSH→codex 走 `codex queue` 优先 / pty 注入回退），新 codex 通过 `-c developer_instructions`
注入 sidebar-codex 身份。

Architecture: 双半插件。host 半拥有 codex 进程、transcript、WS 升级、回环 API 与 DSH 工具；
client 半只做一件事——向 `ctx.betterSidebar.registerTab` 注册一个 xterm 页面。
codex→DSH 的唯一投递 owner 是 `dsh-bridge`；本插件不建第二条消息总线。

Tech Stack: TypeScript 5.6 / Node 24 / tsdown 0.22（host ESM + client CJS closure bundle）/
vitest 4 / node-pty 1.1 / ws 8 / @xterm/xterm 5.5 / React 18（client，external）。

Baseline & Authority Refs:
- `docs/aegis/specs/2026-09-24-codex-sidebar-design.md`（已批准设计，本计划的唯一需求来源）
- `docs/aegis/baseline/2026-09-24-initial-baseline.md`（owner/契约基线）
- `dsh-better-sidebar/docs/external-plugin-guide.md` §3/§4/§10（侧栏注册契约，权威）
- `dsh-better-sidebar/src/client/TerminalView.tsx`、`src/pty-manager.ts`、`src/index.ts:1240-1355`
  （PTY/WS 生命周期参照实现）
- `dsh-bridge/lib/index.js`（`deliverExternal` 语义）、`src/index.ts:1057-1131`（WS 注册/拆除范式）
- codex-cli 0.156.1 实测：`-c developer_instructions` 生效、`codex queue --thread` 能注入运行中的 TUI、
  `TERM=dumb` 硬拒绝、新目录先弹 `Trust this folder?`

Compatibility Boundary:
- 不写 `~/.codex/config.toml`、不设 `CODEX_HOME`、不覆盖用户的 approval/sandbox 配置。
- 不改 `dsh-better-sidebar` / `dsh-bridge` / DSH 源码；只消费它们的服务。
- 不注册路由到 `/api`、`/sidebar` 命名空间（避免与既有 owner 冲突）。
- 不重启用户正在使用的 DSH host（本计划全程走 injector 热装配 + 浏览器刷新）。

TDD Route:
- Mode: off（用户未要求 TDD，项目未配置 strict）
- Decision: skipped
- Strict authority: not applicable
- Strict signals: 无（但本计划对纯函数单元仍写回归测试）
- Light eligibility: n/a
- TDD-fit exception: n/a
- Test posture: post-change regression（围栏/解析/策略/argv/协议为纯函数或纯协议，写 vitest 回归）
- Reason: 主要风险在集成与运行时行为（PTY 生命周期、codex TUI 交互），只能端到端验收 A1–A7；
  纯逻辑单元用回归测试锁行为，不假装 RED/GREEN 仪式。
- Verification: `pnpm test`（单元）+ A1–A7 手动端到端（见 Task 6）

Verification: `pnpm install && pnpm run typecheck && pnpm test && pnpm run build`，
随后按 Task 6 的 A1–A7 清单在运行中的 web GUI 实测。

---

## Plan Basis

```text
BaselineUsageDraft:
- Required baseline refs: docs/aegis/specs/2026-09-24-codex-sidebar-design.md;
  docs/aegis/baseline/2026-09-24-initial-baseline.md;
  dsh-better-sidebar/docs/external-plugin-guide.md §3-§4
- Delivered context refs: (host-projected; not authoritative)
- Acknowledged before plan refs: spec §2.2 用户决策、§3.2 owner 表、§4.2 围栏、§4.6 投递策略
- Cited in plan refs: spec §4.1/§4.3/§4.4/§4.6/§4.7/§4.8、guide §4.1（TabDescriptor 字段）
- Missing refs: 无
- Decision: continue

Requirement Ready Check:
- Requirement source refs: 用户 2026-09-24 原话 + 四个澄清问答（spec §2.1/§2.2）
- Goals and scope refs: spec §1/§2.3
- User / scenario refs: spec §2.1（本机单用户 web GUI，可能 LAN）
- Requirement item refs: R1–R8
- Acceptance / verification criteria refs: spec §7 A1–A7
- Open blocker questions: 无（4 个决策已由用户拍板）
- Decision: ready

Change Necessity:
- User-visible need: 侧栏里跑持久 codex 并与 DSH 互通（现无任何插件提供）
- No-change / non-code option: 手动在终端跑 codex + 人工转述（无自动通信、无侧栏集成），不满足 R1/R3/R6
- Why code change is necessary: 需要 PTY 托管、WS 终端、MCP 桥、DSH 工具，均为新代码
- Minimum change boundary: 新插件包 dsh-codex-sidebar（host + client 两半），不改任何既有仓库
- Decision: code-change

Existence Check:
- Proposed new surface: 新插件包 + 自有回环 HTTP 端点 + 自有 WS 路由
- Existing owner / reuse candidate: 侧栏注册→better-sidebar；会话投递→dsh-bridge；
  终端 PTY→better-sidebar 终端表；codex 配置→~/.codex
- Why existing surface is insufficient: better-sidebar 终端 WS 只按“设置里的 shell”起进程，
  不能按页签指定命令（`src/index.ts:1284`）；其 PTY 表随插件 teardown 全灭且不认 codex 语义；
  auth-gate 包装了 DSH webserver 全部路由，无头 MCP shim 无法通过其认证
- Creation proof: 注册表 + 回环端点各承担一个既有 owner 无法承担的职责（codex 实例身份、token 认证）
- Entropy / retirement impact: 新增 1 个 owner（codex 进程/终端）；无 fallback 复制（降级路径显式标记）
- Decision: add-with-proof

Architecture Integrity Lens:
- Invariant: codex 进程只有一个 owner；DSH 会话投递只有一个 owner
- Canonical owner / contract: 见 spec §3.2 表
- Responsibility overlap: 无（终端不双写、投递不双写）
- Higher-level simplification: 复用 dsh-bridge 的 deliverExternal，而不是自建消息表 + 唤醒逻辑
- Retirement / falsifier: 若 better-sidebar 未来原生支持“按页签指定命令”，本插件的 PTY owner 应退休
- Verdict: proceed

Plan Pressure Test:
- Owner / contract / retirement: owner 明确，退休条件已写
- Architecture integrity / higher-level path: 已取更高层 owner（dsh-bridge）
- Verification scope: 纯函数单测 + A1–A7 端到端
- Task executability: 每步含完整代码与命令
- Pressure result: proceed

Complexity Budget:
- Artifact class: 新插件包（约 10 个源文件，最大文件 < 350 行）
- Target files / artifacts: src/*.ts + src/client/*.tsx
- Current pressure: 0（空仓库）
- Projected post-change pressure: 低（单 owner 单职责拆分，registry/ws/tools/deliver 分文件）
- Budget result: within-budget
- Planned governance: 单文件超 350 行即拆分（registry 与 ws 分离）

Plan-Time Complexity Check:
- Target files: src/index.ts（装配，<150 行）、src/registry.ts（<300 行）、src/ws.ts（<150 行）
- Existing size / shape signals: 空仓库，无历史形状
- Owner fit: 每文件一个 owner（装配 / 实例表 / 传输 / 投递 / 桥 / 围栏 / 工具）
- Add-in-place risk: 低
- Better file boundary: 见 §Files
- Recommendation: add owner file（按职责分文件，不堆进 index.ts）
```

## Files

| path | create/modify | owner |
| --- | --- | --- |
| `package.json` | create | 包清单 + `dsh.bundle.patch` + `dsh.client` |
| `tsconfig.json` / `tsconfig.build.json` / `tsconfig.bundle.json` | create | 类型与声明产物 |
| `tsdown.config.ts` | create | host ESM bundle + client closure bundle + CSS 内联插件 |
| `vitest.config.ts` | create | 单测 |
| `cordis.patch.yml` | create | 把插件行插进 bundle |
| `src/index.ts` | create | 装配：服务、路由、工具、teardown |
| `src/registry.ts` | create | codex 实例表 + 生命周期（唯一进程 owner） |
| `src/spawn.ts` | create | codex argv/env 组装（注入身份 + MCP） |
| `src/identity.ts` | create | 注入文本（模型面契约） |
| `src/trust-fence.ts` | create | WS 围栏 |
| `src/ws.ts` | create | `/codex-sidebar/ws` 传输 + park/close/resize |
| `src/http.ts` | create | 浏览器侧 API（state/seen/restart/kill，fenced） |
| `src/loopback.ts` | create | 127.0.0.1 + token 端点（MCP shim 专用） |
| `src/deliver.ts` | create | DSH→codex 投递策略（queue 优先 / pty 回退 / 就绪门） |
| `src/thread-id.ts` | create | threadId 解析（状态行 UUID / rollout 文件名） |
| `src/readiness.ts` | create | 就绪门判定 |
| `src/to-dsh.ts` | create | codex→DSH 投递（dsh-bridge 优先） |
| `src/tools.ts` | create | `codex_send` / `codex_read` / `codex_status` / `codex_restart` |
| `src/mcp-shim.ts` | create | codex 侧 MCP stdio server（独立入口） |
| `src/better-sidebar.ts` | create | 侧栏服务的最小结构镜像类型 |
| `src/client/index.tsx` | create | 注册 tab |
| `src/client/CodexView.tsx` | create | xterm 视图 + 工具栏 + 未读 |
| `src/client/state.ts` | create | 客户端状态轮询 + 角标计数 |
| `src/client/pty-deps.ts` | create | node-pty 懒加载 + spawn-helper 修复 |
| `tests/*.spec.ts` | create | 围栏 / 解析 / 就绪门 / argv / 投递策略 / MCP 协议 |
| `README.md` | create | 安装、行为、已知边界、验收记录 |

---

## Task 1 — 骨架、构建管线、空页签可见

**Files**: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `tsconfig.bundle.json`,
`tsdown.config.ts`, `vitest.config.ts`, `cordis.patch.yml`, `.gitignore`,
`src/index.ts`, `src/client/index.tsx`, `src/better-sidebar.ts`, `README.md`

**Why**: 先让“一个能被 DSH 加载、能在侧栏 + 菜单里出现 Codex 条目”的闭环成立，
后面每个 Task 才有可运行的载体。

**Change Necessity**: 新包必需；无 no-change 路径。

**Impact/Compatibility**: 只新增 profile 依赖行与 bundle 行；不动既有插件。
**风险**：热装配需要 injector（`dev_install_package`），不得重启用户的 DSH host。

**Steps**

1. 写 `package.json`（完整内容）：

```json
{
  "name": "dsh-codex-sidebar",
  "version": "0.1.0",
  "description": "DSH web plugin: a persistent codex-cli TUI in the right sidebar, bound 1:1 to a conversation, with plugin-mediated codex <-> DSH messaging.",
  "type": "module",
  "license": "MIT",
  "main": "./lib/index.js",
  "types": "./lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/client.js", "lib/codex-mcp.js", "lib/types/**/*.d.ts", "cordis.patch.yml", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": [] }
  },
  "scripts": {
    "build": "node -e \"require('node:fs').rmSync('lib',{recursive:true,force:true})\" && tsc -p tsconfig.build.json && tsdown",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "bundle": "tsdown"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.2",
    "react": "^18.2.0"
  },
  "dependencies": {
    "node-pty": "^1.1.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.2",
    "@deepseek-ai/dsh-host-webserver": "0.1.5-rc.1",
    "@deepseek-ai/dsh-llm": "0.1.5-rc.1",
    "@deepseek-ai/dsh-session": "0.1.5-rc.1",
    "@deepseek-ai/dsh-session-persistence": "0.1.5-rc.1",
    "@deepseek-ai/dsh-tools": "0.1.5-rc.1",
    "@types/node": "^24.0.0",
    "@types/react": "~18.3.1",
    "@types/ws": "^8.5.10",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/xterm": "^5.5.0",
    "react": "^18.2.0",
    "tsdown": "^0.22.2",
    "typescript": "^5.6.0",
    "vitest": "^4.1.8"
  }
}
```

> 说明（有意决定）：**不把 `dsh-better-sidebar` 装成依赖**。我们只需要它的服务形状，
> 用 `src/better-sidebar.ts` 做结构镜像（与 better-sidebar 自己对 DSH 服务的做法一致），
> 避免为一个类型拉进 mermaid/codemirror 级别的依赖树。运行时用能力探测兜底（见 Task 1 step 6）。

2. 写三个 tsconfig（照抄 `dsh-lan-access` 的可用配方，`rewriteRelativeImportExtensions`
   让我们在源码里写 `.ts` 后缀导入、由 tsc/tsdown 改写）：

`tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noImplicitAny": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

`tsconfig.build.json`
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "lib/types"
  },
  "include": ["src"]
}
```

`tsconfig.bundle.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

3. 写 `tsdown.config.ts`（三个产物：host `lib/index.js`、MCP 入口 `lib/codex-mcp.js`、
   client `lib/client.js`；含 CSS 内联插件——xterm 的样式表必须内联进 bundle，
   因为 `/plugins/<id>/client.js` 之外的文件不会被服务）：

```ts
/**
 * tsdown build for dsh-codex-sidebar.
 *
 * - lib/index.js     host half (ESM, node)
 * - lib/codex-mcp.js the MCP stdio server codex spawns (ESM, node)
 * - lib/client.js    browser half: CJS closure factory registered through
 *                    window.__ModuleLoader__.load({ id, factory })
 *
 * CSS imports (xterm's stylesheet) are inlined into <style data-plugin-css>
 * tags by the local plugin below: a plugin bundle is served as ONE file, so a
 * separate .css asset would never load.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { UserConfig } from 'tsdown'

const CLIENT_ID = 'dsh-codex-sidebar'
const CSS_VIRTUAL_PREFIX = '\0codex-sidebar-css:'

/** Module specifiers the web shell seeds into its frozen module table. */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime']

/** Inline every imported .css as a style tag (idempotent per file). */
function cssInlinePlugin(): NonNullable<UserConfig['plugins']>[number] {
  const require = createRequire(import.meta.url)
  return {
    name: 'codex-sidebar-css-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css')) return null
      if (source.startsWith('.') && importer !== undefined) {
        return CSS_VIRTUAL_PREFIX + require.resolve(source, { paths: [importer] })
      }
      return CSS_VIRTUAL_PREFIX + require.resolve(source)
    },
    load(id: string) {
      if (!id.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const file = id.slice(CSS_VIRTUAL_PREFIX.length)
      const css = readFileSync(file, 'utf8')
      return [
        `const css = ${JSON.stringify(css)};`,
        `const tagId = ${JSON.stringify(file)};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
        `  const tag = document.createElement('style');`,
        `  tag.setAttribute('data-plugin-css', tagId);`,
        `  tag.textContent = css;`,
        `  document.head.appendChild(tag);`,
        `}`,
        `export default css;`,
      ].join('\n')
    },
  }
}

const hostConfig: UserConfig = {
  entry: { index: 'src/index.ts', 'codex-mcp': 'src/mcp-shim.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: ['node-pty'],
  tsconfig: 'tsconfig.bundle.json',
}

const clientConfig: UserConfig = {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  tsconfig: 'tsconfig.bundle.json',
  external: [...CLIENT_EXTERNALS],
  plugins: [cssInlinePlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  inputOptions: {
    resolve: { conditionNames: ['browser', 'import', 'require', 'default'] },
  },
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_ID)}, factory: (require) => {`,
    footer: `return module.exports; } });`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}

export default [hostConfig, clientConfig] satisfies UserConfig[]
```

4. 写 `vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.spec.ts'] },
})
```

5. 写 `cordis.patch.yml`：
```yaml
# dsh-codex-sidebar bundle patch. Mounted by the official CLI:
#   dsh plugin --profile web add file:/wafer/chh/gitprojects/dsh-codex-sidebar
# The row is dual-face: the node half owns the codex registry, the WS upgrade
# and the DSH tools; the `dsh.client` manifest in package.json routes the
# browser half (the sidebar tab) into the client module table.
- insert:
    - id: dsh-codex-sidebar
      name: 'dsh-codex-sidebar'
      inject: [webServer, tools]
```

6. 写 `src/better-sidebar.ts`（结构镜像 + 能力探测）：
```ts
/**
 * Minimal structural mirror of dsh-better-sidebar's CLIENT service
 * (`ctx.betterSidebar`). Deliberately NOT a dependency: the service shape is
 * consumed at runtime and checked by `supportsTabs()` before use, so a
 * sidebar upgrade that drops `registerTab` degrades to "no tab + loud log"
 * instead of a build break.
 */
import type { ReactNode } from 'react'

export interface SidebarSessionScope { sessionId: string; cwd?: string }

export interface SidebarTab {
  id: string
  type: string
  title: string
  path?: string
  meta?: unknown
}

export interface SidebarTabComponentProps {
  ctx: unknown
  store: unknown
  scope: SidebarSessionScope
  tab: SidebarTab
  visible: boolean
}

export interface SidebarTabDescriptor {
  id: string
  title: string | (() => string)
  description?: string | (() => string)
  icon?: ReactNode | ((size: number) => ReactNode)
  order?: number
  hidden?: boolean
  single?: boolean
  badge?: (ctx: unknown, scope: SidebarSessionScope, state: unknown) => string | number | null | undefined
  component: (props: SidebarTabComponentProps) => ReactNode
}

export interface BetterSidebarService {
  registerTab(descriptor: SidebarTabDescriptor): () => void
  readonly version: string
  readonly features: readonly string[]
}

/** True when the published service can host an external tab. */
export function supportsTabs(service: unknown): service is BetterSidebarService {
  const candidate = service as Partial<BetterSidebarService> | undefined
  return typeof candidate?.registerTab === 'function'
}
```

7. 写 `src/index.ts`（Task 1 只做装配骨架，后续 Task 往里挂）：
```ts
/**
 * dsh-codex-sidebar — host half.
 *
 * Task 1 scope: activation skeleton only (no PTY yet). The row exists so the
 * bundle patch mounts, and so the client half has a host to talk to.
 */
export const name = 'dsh-codex-sidebar'
export const inject = ['webServer', 'tools']

export function apply(): void {
  // Task 2 wires the registry + WS upgrade; Task 3 the loopback + tools.
}
```

8. 写 `src/client/index.tsx`（最小可用页签：Task 2 换成 xterm 视图）：
```tsx
/**
 * dsh-codex-sidebar — client half. Registers the sidebar tab. The service is
 * resolved defensively (`ctx.get`) so a missing/older better-sidebar cannot
 * break the whole client activation.
 */
import type { Context } from '@deepseek-ai/cordis'
import { supportsTabs, type SidebarTabComponentProps } from '../better-sidebar.ts'

export const inject = ['betterSidebar']

function CodexTabPlaceholder({ scope }: SidebarTabComponentProps) {
  return <div style={{ padding: 12, fontFamily: 'monospace' }}>codex-sidebar: {scope.sessionId}</div>
}

export function apply(ctx: Context): void {
  const service = ctx.get('betterSidebar')
  if (!supportsTabs(service)) {
    console.error('[dsh-codex-sidebar] betterSidebar service unavailable; tab not registered')
    return
  }
  ctx.effect(() =>
    service.registerTab({
      id: 'codex-sidebar:codex',
      title: 'Codex',
      description: '在侧栏里跑一个持久 codex，并与本对话互通消息',
      order: 45,
      single: true,
      component: (props) => <CodexTabPlaceholder {...props} />,
    }),
  )
}
```

9. `.gitignore`：`node_modules/`、`lib/`、`*.tgz`。

10. 构建并装配：
```bash
cd /wafer/chh/gitprojects/dsh-codex-sidebar
pnpm install
pnpm run typecheck
pnpm run build
ls lib/index.js lib/codex-mcp.js lib/client.js lib/types/index.d.ts
```
Expected: 四个文件都存在；`lib/client.js` 首行为 `window.__ModuleLoader__.load({ id: "dsh-codex-sidebar", factory: (require) => {`。

11. 热装配（**不重启 host**）：用 `dev_install_package`（dir = 插件目录）。
Expected: 返回 installed；`dev_plugin_status` 出现 `dsh-codex-sidebar` 且 fiber `active`。

12. 浏览器刷新页面 → 右侧栏 `+` 菜单出现 `Codex` 条目；打开后显示 `codex-sidebar: <sessionId>`。
Expected: A1 的“入口可见”部分成立。失败则检查 client bundle 是否被 client-modules 扫到
（host 日志里的 client-meta 重解析记录）。

**Commit**: `feat: plugin skeleton, build pipeline, sidebar tab registration`

---

## Task 2 — codex 实例表 + PTY + WS 终端（A1、A2）

**Files**: `src/pty-deps.ts`, `src/registry.ts`, `src/spawn.ts`, `src/identity.ts`,
`src/trust-fence.ts`, `src/ws.ts`, `src/index.ts`, `src/client/CodexView.tsx`,
`src/client/index.tsx`, `tests/trust-fence.spec.ts`, `tests/spawn.spec.ts`

**Why**: 这是插件的核心价值面——一个真正能用的持久 codex 终端。

**Impact/Compatibility**: 新增路由 `/codex-sidebar/ws`；不改动既有命名空间。

**Steps**

1. `src/identity.ts`（模型面契约，改动需同步 spec §4.4 与单测）：
```ts
/** The injected identity context (spec §4.4). Model-facing contract. */
export function identityText(input: { sessionId: string; cwd: string }): string {
  return [
    'You are running as a "sidebar-codex" inside DeepSeek Harness (DSH).',
    `- Bound DSH session: ${input.sessionId}; working directory: ${input.cwd}. You do NOT share that`,
    "  conversation's context; it never sees your transcript unless you send it.",
    '- You can talk to DSH through the MCP server `dsh`:',
    '  `mcp__dsh__send_message` (deliver text to the bound DSH session; it wakes that agent),',
    '  `mcp__dsh__read_messages` (read messages DSH sent to you),',
    '  `mcp__dsh__status` (bound session id/title/cwd).',
    '- Messages from DSH arrive as user messages; DSH identifies itself in the envelope.',
    '- Prefer answering the user in this TUI; use `send_message` when DSH needs the result.',
  ].join('\n')
}
```

2. `src/spawn.ts`（argv/env 组装；**纯函数**，可单测）：
```ts
import { identityText } from './identity.ts'

export interface SpawnInput {
  /** Absolute path to this plugin's built MCP shim. */
  shimPath: string
  /** Node executable that runs the shim (the DSH host's own node). */
  nodePath: string
  sessionId: string
  instanceId: string
  cwd: string
  loopbackUrl: string
  loopbackToken: string
  /** The user's own developer_instructions, when their config.toml sets one. */
  userDeveloperInstructions?: string
  /** codex executable (resolved from PATH by the caller). */
  codexPath: string
}

export interface SpawnPlan {
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
}

/** Build the codex argv/env. Pure: no I/O, no process state. */
export function buildSpawnPlan(input: SpawnInput): SpawnPlan {
  const instructions = [identityText({ sessionId: input.sessionId, cwd: input.cwd })]
  if (input.userDeveloperInstructions !== undefined && input.userDeveloperInstructions !== '') {
    instructions.push(input.userDeveloperInstructions)
  }
  const args = [
    '-c', `developer_instructions=${JSON.stringify(instructions.join('\n\n'))}`,
    '-c', `mcp_servers.dsh.command=${JSON.stringify(input.nodePath)}`,
    '-c', `mcp_servers.dsh.args=${JSON.stringify([input.shimPath])}`,
    '-c', `mcp_servers.dsh.env=${JSON.stringify({
      DSH_CODEX_URL: input.loopbackUrl,
      DSH_CODEX_TOKEN: input.loopbackToken,
      DSH_CODEX_INSTANCE: input.instanceId,
      DSH_CODEX_SESSION: input.sessionId,
    })}`,
  ]
  return {
    file: input.codexPath,
    args,
    // TERM=dumb is a hard refusal in codex 0.156; the pty name alone is not enough
    // because node-pty inherits the parent env.
    env: { ...process.env, TERM: 'xterm-256color', DSH_CODEX_INSTANCE: input.instanceId },
    cwd: input.cwd,
  }
}
```

3. `src/pty-deps.ts`（node-pty 懒加载 + pnpm 剥掉的 spawn-helper 执行位修复；后者的
   必要性来自 better-sidebar `src/pty-manager.ts:27-44` 的实测结论）：
```ts
import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { IPty } from 'node-pty'

export interface NodePtyModule {
  spawn(file: string, args: string[] | string, options: Record<string, unknown>): IPty
}

let cached: NodePtyModule | null = null

/** Restore the executable bit pnpm strips from node-pty's spawn-helper. */
export function ensureSpawnHelper(): void {
  if (process.platform === 'win32') return
  try {
    const require = createRequire(import.meta.url)
    const entry = require.resolve('node-pty')
    const root = dirname(dirname(entry))
    for (const helper of [
      join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
      join(root, 'build', 'Release', 'spawn-helper'),
    ]) {
      if (existsSync(helper)) chmodSync(helper, 0o755)
    }
  } catch {
    // Resolution failure surfaces as a spawn error with a readable message.
  }
}

/** Load node-pty once; throws a readable error when the native module is absent. */
export async function loadNodePty(): Promise<NodePtyModule> {
  if (cached !== null) return cached
  ensureSpawnHelper()
  const mod = (await import('node-pty')) as unknown as NodePtyModule
  cached = mod
  return mod
}
```

4. `src/registry.ts`（唯一进程 owner；pty 通过依赖注入以便单测）：
```ts
import { randomUUID } from 'node:crypto'
import type { IPty } from 'node-pty'
import { loadNodePty } from './pty-deps.ts'
import { buildSpawnPlan, type SpawnInput } from './spawn.ts'

const TRANSCRIPT_LIMIT = 1 << 20 // 1 MiB, same bound as better-sidebar's terminal

export type CodexState = 'starting' | 'running' | 'exited' | 'error'

export interface CodexMessage {
  id: string
  from: 'dsh' | 'codex'
  text: string
  at: number
}

export interface CodexInstance {
  id: string
  sessionId: string
  cwd: string
  spawn: SpawnInput
  pty: IPty
  transcript: string
  /** Last 4 KiB of output, for readiness/marker scanning. */
  tail: string
  state: CodexState
  exitCode?: number
  error?: string
  threadId?: string
  /** codex → DSH messages delivered since the user last looked. */
  unread: number
  /** DSH → codex messages (readable by the MCP shim). */
  inboxForCodex: CodexMessage[]
  /** codex → DSH messages (readable by the codex_read tool). */
  inboxForDsh: CodexMessage[]
  /** Messages waiting for the readiness gate. */
  pending: CodexMessage[]
  parked: boolean
  closeTimer?: NodeJS.Timeout
  spawnAt: number
  lastOutputAt: number
}

export interface RegistryOptions {
  /** Resolve the spawn plan (tests inject a fake). */
  plan(input: SpawnInput): { file: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string }
  /** Spawn a pty (tests inject a fake IPty). */
  spawnPty(plan: { file: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string }, size: { cols: number; rows: number }): Promise<IPty>
  onMessage?(instance: CodexInstance, message: CodexMessage): void
  onStateChange?(instance: CodexInstance): void
}

export class CodexRegistry {
  private readonly bySession = new Map<string, CodexInstance>()
  private readonly byId = new Map<string, CodexInstance>()

  constructor(private readonly options: RegistryOptions) {}

  list(): CodexInstance[] { return [...this.byId.values()] }
  get(sessionId: string): CodexInstance | undefined { return this.bySession.get(sessionId) }
  getById(id: string): CodexInstance | undefined { return this.byId.get(id) }

  /** Get-or-create the session's codex instance (1:1 binding). */
  async open(spawn: SpawnInput, size: { cols: number; rows: number }): Promise<CodexInstance> {
    const existing = this.bySession.get(spawn.sessionId)
    if (existing !== undefined && existing.state !== 'exited' && existing.state !== 'error') {
      this.cancelClose(existing.id)
      existing.parked = false
      return existing
    }
    if (existing !== undefined) this.dispose(existing.id)
    const instance = await this.create(spawn, size)
    return instance
  }

  private async create(spawn: SpawnInput, size: { cols: number; rows: number }): Promise<CodexInstance> {
    const plan = this.options.plan(spawn)
    const pty = await this.options.spawnPty(plan, size)
    const instance: CodexInstance = {
      id: spawn.instanceId,
      sessionId: spawn.sessionId,
      cwd: spawn.cwd,
      spawn,
      pty,
      transcript: '',
      tail: '',
      state: 'running',
      unread: 0,
      inboxForCodex: [],
      inboxForDsh: [],
      pending: [],
      parked: false,
      spawnAt: Date.now(),
      lastOutputAt: Date.now(),
    }
    pty.onData((data) => {
      instance.transcript += data
      if (instance.transcript.length > TRANSCRIPT_LIMIT) {
        instance.transcript = instance.transcript.slice(instance.transcript.length - TRANSCRIPT_LIMIT)
      }
      instance.tail = (instance.tail + data).slice(-4096)
      instance.lastOutputAt = Date.now()
    })
    pty.onExit(({ exitCode }) => {
      instance.state = 'exited'
      instance.exitCode = exitCode
      this.options.onStateChange?.(instance)
    })
    this.bySession.set(instance.sessionId, instance)
    this.byId.set(instance.id, instance)
    this.options.onStateChange?.(instance)
    return instance
  }

  /** codex → DSH bookkeeping: record + bump unread. */
  recordToDsh(instance: CodexInstance, text: string): CodexMessage {
    const message: CodexMessage = { id: randomUUID(), from: 'codex', text, at: Date.now() }
    instance.inboxForDsh.push(message)
    instance.inboxForDsh = instance.inboxForDsh.slice(-200)
    instance.unread += 1
    this.options.onMessage?.(instance, message)
    return message
  }

  /** DSH → codex bookkeeping (the MCP shim reads this inbox). */
  recordToCodex(instance: CodexInstance, text: string): CodexMessage {
    const message: CodexMessage = { id: randomUUID(), from: 'dsh', text, at: Date.now() }
    instance.inboxForCodex.push(message)
    instance.inboxForCodex = instance.inboxForCodex.slice(-200)
    this.options.onMessage?.(instance, message)
    return message
  }

  markSeen(sessionId: string): void {
    const instance = this.bySession.get(sessionId)
    if (instance !== undefined) instance.unread = 0
  }

  park(id: string): void {
    const instance = this.byId.get(id)
    if (instance === undefined) return
    this.cancelClose(id)
    instance.parked = true
  }

  /** Schedule destruction after `delayMs` (0 = now). Reopening cancels it. */
  scheduleClose(id: string, delayMs: number): void {
    const instance = this.byId.get(id)
    if (instance === undefined) return
    this.cancelClose(id)
    instance.closeTimer = setTimeout(() => { this.dispose(id) }, delayMs)
  }

  cancelClose(id: string): void {
    const instance = this.byId.get(id)
    if (instance?.closeTimer !== undefined) {
      clearTimeout(instance.closeTimer)
      instance.closeTimer = undefined
    }
  }

  dispose(id: string): void {
    const instance = this.byId.get(id)
    if (instance === undefined) return
    this.cancelClose(id)
    this.bySession.delete(instance.sessionId)
    this.byId.delete(id)
    try { instance.pty.kill() } catch { /* already gone */ }
  }

  disposeAll(): void {
    for (const id of [...this.byId.keys()]) this.dispose(id)
  }
}

/** Production spawn: node-pty with an xterm-256color terminal. */
export async function spawnCodexPty(
  plan: { file: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string },
  size: { cols: number; rows: number },
): Promise<IPty> {
  const nodePty = await loadNodePty()
  return nodePty.spawn(plan.file, plan.args, {
    name: 'xterm-256color',
    cols: Math.max(2, size.cols),
    rows: Math.max(2, size.rows),
    cwd: plan.cwd,
    env: plan.env,
  })
}

/** Convenience: build the production registry options. */
export function productionOptions(input: {
  onMessage?(instance: CodexInstance, message: CodexMessage): void
  onStateChange?(instance: CodexInstance): void
}): RegistryOptions {
  return {
    plan: buildSpawnPlan,
    spawnPty: spawnCodexPty,
    ...(input.onMessage === undefined ? {} : { onMessage: input.onMessage }),
    ...(input.onStateChange === undefined ? {} : { onStateChange: input.onStateChange }),
  }
}
```

5. `src/trust-fence.ts`（**安全边界，必须有单测**）：
```ts
/**
 * Upgrade fence for /codex-sidebar/ws.
 *
 * dsh-auth-gate authenticates but does NOT defend DNS rebinding or cross-site
 * WebSocket hijacking: a hostile page can open a WS to this host and the
 * browser attaches cookies automatically. So the plugin owns the fence:
 * same-origin Origin/Host match, cross-site fetch metadata rejected, and the
 * Host must be loopback or an authority DSH already trusts (LAN literals when
 * the webserver binds 0.0.0.0).
 */
import type { IncomingMessage } from 'node:http'

function hostnameOf(authority: string): string {
  const value = authority.trim()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(1, end)
  }
  const colon = value.lastIndexOf(':')
  return colon === -1 ? value : value.slice(0, colon)
}

export function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1') return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (match === null) return false
  const octets = match.slice(1).map(Number)
  return octets.every((part) => part <= 255) && octets[0] === 127
}

/** Whether an upgrade request may open the codex terminal. */
export function isTrustedUpgrade(req: IncomingMessage, trustedHosts: readonly string[]): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  const hostname = hostnameOf(host)
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    let originHost: string
    try {
      originHost = new URL(origin).hostname
    } catch {
      return false
    }
    if (originHost !== hostname) return false
  }
  if (isLoopbackHost(hostname)) return true
  return trustedHosts.includes(hostname) || trustedHosts.includes(host)
}
```

6. `src/ws.ts`（传输层；生命周期语义照 spec §4.2）：
```ts
/**
 * /codex-sidebar/ws?sessionId=<id>
 *
 * Frames are the same shape better-sidebar's terminal uses: a non-JSON frame
 * is raw keyboard input; JSON frames are controls ({type:'resize'|'park'|'close'}).
 * Server → client is raw pty output. Closing the tab PARKS (detach) instead of
 * killing: the codex keeps running and a later connection replays the transcript.
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { CodexInstance, CodexRegistry } from './registry.ts'

export interface WsDeps {
  registry: CodexRegistry
  /** Resolve the session's spawn input (cwd + loopback endpoint + token). */
  prepare(sessionId: string, clientCwd?: string): Promise<{ instanceId: string; spawn: Parameters<CodexRegistry['open']>[0]; cwd: string }>
  trustedHosts(): readonly string[]
  isTrusted(req: IncomingMessage): boolean
  reconnectGraceMs?: number
}

export interface WsHandle {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  close(): void
}

export function createCodexWs(deps: WsDeps): WsHandle {
  const wss = new WebSocketServer({ noServer: true })
  const grace = deps.reconnectGraceMs ?? 30_000

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    void attach(ws, req)
  })

  async function attach(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const sessionId = url.searchParams.get('sessionId')
    if (sessionId === null || sessionId === '') {
      ws.close(1008, 'sessionId is required')
      return
    }
    let instance: CodexInstance
    try {
      const prepared = await deps.prepare(sessionId, url.searchParams.get('cwd') ?? undefined)
      instance = await deps.registry.open(prepared.spawn, { cols: 80, rows: 24 })
    } catch (error) {
      ws.close(1011, `codex-spawn-failed:${(error as Error).message.slice(0, 80)}`)
      return
    }
    deps.registry.cancelClose(instance.id)
    instance.parked = false
    if (instance.transcript !== '') ws.send(instance.transcript)

    const onData = (data: string): void => {
      if (ws.readyState === ws.OPEN && ws.bufferedAmount < 4 * 1024 * 1024) ws.send(data)
    }
    const onExit = ({ exitCode }: { exitCode: number }): void => {
      onData(`\r\n[codex exited with code ${String(exitCode)}]\r\n`)
    }
    const dataSub = instance.pty.onData(onData)
    const exitSub = instance.pty.onExit(onExit)

    ws.on('message', (raw) => {
      const text = raw.toString()
      if (!text.startsWith('{')) {
        instance.pty.write(text)
        return
      }
      try {
        const frame = JSON.parse(text) as { type?: string; cols?: number; rows?: number }
        if (frame.type === 'resize' && typeof frame.cols === 'number' && typeof frame.rows === 'number') {
          try { instance.pty.resize(Math.max(2, frame.cols), Math.max(2, frame.rows)) } catch { /* exited */ }
          return
        }
        if (frame.type === 'park') {
          deps.registry.park(instance.id)
          return
        }
        if (frame.type === 'close') {
          // Detach: the view is gone, the codex keeps running (spec §2.2).
          deps.registry.park(instance.id)
          return
        }
      } catch {
        instance.pty.write(text)
      }
    })

    ws.on('close', () => {
      dataSub.dispose()
      exitSub.dispose()
      if (!instance.parked) deps.registry.scheduleClose(instance.id, grace)
    })
  }

  return {
    handleUpgrade(req, socket, head) {
      if (!deps.isTrusted(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req) })
    },
    close() { wss.close() },
  }
}
```

7. `src/client/CodexView.tsx`（xterm 视图；键盘直接进 xterm，与 sidebar 终端一致）：
```tsx
/**
 * The codex terminal view. Mirrors better-sidebar's TerminalView contract:
 * raw input frames out, raw output frames in, JSON control frames for
 * resize/park/close. The tab being unmounted with the tab still open and the
 * session switched = park; closing the tab = detach (no kill).
 */
import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { SidebarTabComponentProps } from '../better-sidebar.ts'

const FAILURE_LIMIT = 3

export function CodexView({ scope, visible, tab }: SidebarTabComponentProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const term = new Terminal({
      convertEol: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      scrollback: 5000,
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const url = new URL('/codex-sidebar/ws', location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('sessionId', scope.sessionId)
    if (scope.cwd !== undefined) url.searchParams.set('cwd', scope.cwd)
    let socket: WebSocket | null = null
    let failures = 0
    let disposed = false

    const connect = (): void => {
      if (disposed) return
      const ws = new WebSocket(url)
      socket = ws
      ws.onopen = () => {
        failures = 0
        setError(null)
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
      ws.onmessage = (event) => { term.write(String(event.data)) }
      ws.onclose = (event) => {
        if (disposed) return
        if (event.reason !== '') {
          failures += 1
          setError(event.reason)
          if (failures >= FAILURE_LIMIT) return
        }
        setTimeout(connect, 2000)
      }
    }
    connect()

    const inputSub = term.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(data)
    })
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }))
    })
    const onWindowResize = (): void => { try { fit.fit() } catch { /* hidden */ } }
    window.addEventListener('resize', onWindowResize)
    const observer = new ResizeObserver(onWindowResize)
    observer.observe(host)

    return () => {
      disposed = true
      window.removeEventListener('resize', onWindowResize)
      observer.disconnect()
      inputSub.dispose()
      resizeSub.dispose()
      // Unmount with the tab still open = the user switched conversations:
      // park (keep the codex alive). A real close is handled by onClose below.
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'park' }))
      socket?.close()
      term.dispose()
    }
  }, [scope.sessionId])

  useEffect(() => {
    if (visible) void fetch('/codex-sidebar/api/seen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: scope.sessionId }),
    }).catch(() => undefined)
  }, [visible, scope.sessionId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {error !== null && (
        <div style={{ padding: '4px 8px', fontSize: 12, color: '#f48771' }}>
          codex 连接异常：{error} <button onClick={() => location.reload()}>重试</button>
        </div>
      )}
      <div ref={hostRef} data-codex-tab={tab.id} style={{ flex: 1, minHeight: 0, padding: 4 }} />
    </div>
  )
}
```

8. `src/index.ts` 挂载 registry + WS（Task 1 的骨架替换为）：
```ts
import { randomUUID } from 'node:crypto'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { CodexRegistry, productionOptions, type CodexInstance } from './registry.ts'
import { buildSpawnPlan, type SpawnInput } from './spawn.ts'
import { isTrustedUpgrade } from './trust-fence.ts'
import { createCodexWs } from './ws.ts'

export const name = 'dsh-codex-sidebar'
export const inject = ['webServer', 'tools']

/** Resolve the codex executable from PATH (same PATH the host runs with). */
function resolveCodex(): string {
  const path = process.env.PATH ?? ''
  for (const dir of path.split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, process.platform === 'win32' ? 'codex.cmd' : 'codex')
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch { /* keep looking */ }
  }
  throw new Error('codex executable not found on PATH')
}

/** Session cwd: live header first, then the client hint, then the persisted header. */
async function sessionCwdOf(ctx: Context, sessionId: string, hint?: string): Promise<string> {
  const live = ctx.get('sessions')?.get?.(sessionId)?.header?.cwd
  if (typeof live === 'string' && live !== '') return live
  if (hint !== undefined && hint !== '') return hint
  const persistence = ctx.get('sessionPersistence')
  if (persistence !== undefined) {
    const handle = await persistence.open(sessionId, 'read')
    try {
      const cwd = handle.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') return cwd
    } finally {
      await handle.close()
    }
  }
  return process.cwd()
}

export function apply(ctx: Context): void {
  const registry = new CodexRegistry(productionOptions({}))
  const shimPath = join(pluginRoot(), 'codex-mcp.js')
  const codexPath = resolveCodex()
  const loopback = createLoopback({ registry })          // Task 3
  ctx.effect(() => () => { registry.disposeAll(); void loopback.close() })

  const ws = createCodexWs({
    registry,
    trustedHosts: () => ctx.get('webRuntime')?.trustedHosts ?? [],
    isTrusted: (req) => isTrustedUpgrade(req, ctx.get('webRuntime')?.trustedHosts ?? []),
    prepare: async (sessionId, hint) => {
      const cwd = await sessionCwdOf(ctx, sessionId, hint)
      const instanceId = randomUUID()
      const spawn: SpawnInput = {
        shimPath, nodePath: process.execPath, sessionId, instanceId, cwd,
        loopbackUrl: loopback.url, loopbackToken: loopback.tokenFor(instanceId),
        codexPath, ...(userDeveloperInstructions() ?? {}),
      }
      return { instanceId, spawn, cwd }
    },
  })
  ctx.effect(() => ctx.webServer.registerUpgrade({ path: '/codex-sidebar/ws', handler: ws.handleUpgrade }))
  ctx.effect(() => () => ws.close())
}
```
（`pluginRoot()` = `dirname(fileURLToPath(import.meta.url))`；`userDeveloperInstructions()` 读
`~/.codex/config.toml` 里顶层 `developer_instructions` 的字符串值，读不到就返回 undefined。
`createLoopback` 与工具注册在 Task 3/4 补上；本 Task 先让 WS 跑通，可临时把 loopback 换成
一个返回固定 url/token 的桩，并在 Task 3 替换。）

9. `src/client/index.tsx` 的 `component` 换成 `CodexView`。

10. 单测 `tests/trust-fence.spec.ts`（完整）：
```ts
import { describe, expect, it } from 'vitest'
import { isTrustedUpgrade, isLoopbackHost } from '../src/trust-fence.ts'

function req(headers: Record<string, string>): never {
  return { headers } as never
}

describe('isLoopbackHost', () => {
  it('accepts loopback literals', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('127.1.2.3')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
  })
  it('rejects non-loopback', () => {
    expect(isLoopbackHost('10.0.0.5')).toBe(false)
    expect(isLoopbackHost('evil.example')).toBe(false)
  })
})

describe('isTrustedUpgrade', () => {
  it('allows loopback browser origin', () => {
    expect(isTrustedUpgrade(req({ host: '127.0.0.1:9000', origin: 'http://127.0.0.1:9000' }), [])).toBe(true)
  })
  it('rejects cross-site fetch metadata', () => {
    expect(isTrustedUpgrade(req({ host: '127.0.0.1:9000', 'sec-fetch-site': 'cross-site' }), [])).toBe(false)
  })
  it('rejects an origin whose host differs from Host', () => {
    expect(isTrustedUpgrade(req({ host: '127.0.0.1:9000', origin: 'http://evil.example' }), [])).toBe(false)
  })
  it('rejects a foreign Host without trust', () => {
    expect(isTrustedUpgrade(req({ host: '10.0.0.5:9000' }), [])).toBe(false)
  })
  it('accepts a LAN authority DSH trusts', () => {
    expect(isTrustedUpgrade(req({ host: '10.0.0.5:9000', origin: 'http://10.0.0.5:9000' }), ['10.0.0.5'])).toBe(true)
  })
  it('rejects an absent Host', () => {
    expect(isTrustedUpgrade(req({}), [])).toBe(false)
  })
})
```

11. 单测 `tests/spawn.spec.ts`（断言 argv 里出现 `developer_instructions`、`mcp_servers.dsh.command`、
    `TERM=xterm-256color`，且用户 `developer_instructions` 被追加而非覆盖）。

12. 验证：
```bash
pnpm run typecheck && pnpm test && pnpm run build
```
Expected: 全部通过；`dev_reload_package` 重载后刷新页面 → 打开 Codex 页签看到真实 codex TUI。

13. 手动检查 A1（可交互：打字有回显、方向键可用、Ctrl+C 能中断）、A2（刷新页面后 transcript
    回放且进程未重启：`ps -o pid,etime -p <pid>` 的 etime 持续增长；切对话再回仍是同一 pid）。

**Commit**: `feat: codex instance registry, PTY transport and sidebar terminal view`

---

## Task 3 — 回环端点 + MCP shim + codex→DSH 投递（A3）

**Files**: `src/loopback.ts`, `src/mcp-shim.ts`, `src/to-dsh.ts`, `src/tools.ts`, `src/index.ts`,
`tests/mcp-shim.spec.ts`, `tests/loopback.spec.ts`

**Why**: 让 codex 能主动把结果送回绑定的 DSH 会话（R6/R7 的另一半）。

**Steps**

1. `src/loopback.ts`：`http.createServer()` 绑 `127.0.0.1:0`；每实例 32 字节随机 token；
   路由 `POST /message`、`GET /inbox?instance=`、`GET /status?instance=`；`Authorization: Bearer` 校验失败 401。
   导出 `createLoopback({registry})` → `{url, tokenFor(instanceId), close()}`。
   `POST /message` 体 `{instance, text}`：解析实例 → `toDsh.deliver(instance, text)` → 返回 `{ok:true, messageId}`。

2. `src/to-dsh.ts`（codex→DSH；**owner 是 dsh-bridge**）：
```ts
/**
 * codex → DSH delivery. The canonical owner is dsh-bridge's documented inbound
 * seam (`ctx.dshBridge.deliverExternal`), which wakes idle/running sessions and
 * resumes cold ones. The direct `agent.followup` path is a LOUD degradation for
 * a host without dsh-bridge, not a second messaging owner (spec ADR-1).
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { CodexInstance } from './registry.ts'

export interface DeliverDeps {
  bridge?: { deliverExternal(from: string, to: string, text: string, options?: { transport?: string }): Promise<unknown> }
  agents?: { get(id: string): { followup(message: unknown): void } | undefined }
  log: { warn(message: string): void }
}

export async function deliverToDsh(deps: DeliverDeps, instance: CodexInstance, text: string): Promise<void> {
  const from = `codex:${instance.id}`
  if (deps.bridge !== undefined) {
    await deps.bridge.deliverExternal(from, instance.sessionId, text, { transport: 'codex' })
    return
  }
  const agent = deps.agents?.get(instance.sessionId)
  if (agent === undefined) throw new Error('dsh-bridge is unavailable and the bound session is not live')
  deps.log.warn('dsh-bridge unavailable: falling back to a direct agent.followup (no audit record)')
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: `[codex-sidebar ${instance.id}] ${text}` }],
    source: { kind: 'plugin', plugin: 'dsh-codex-sidebar' },
  }))
}
```

3. `src/mcp-shim.ts`（独立进程；**不引第三方 SDK**，手写最小 MCP stdio 协议）：
```ts
/**
 * MCP stdio server spawned BY codex (`-c mcp_servers.dsh.command=...`).
 * Minimal newline-delimited JSON-RPC: initialize / tools/list / tools/call.
 * Every tool call is forwarded to the plugin's loopback endpoint with the
 * per-instance bearer token; the shim holds no state of its own.
 */
import { createInterface } from 'node:readline'

const url = process.env.DSH_CODEX_URL ?? ''
const token = process.env.DSH_CODEX_TOKEN ?? ''
const instance = process.env.DSH_CODEX_INSTANCE ?? ''

const TOOLS = [
  {
    name: 'send_message',
    description: 'Send a message to the DSH session this codex is bound to. The DSH agent is woken to read it.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Message text.' } }, required: ['text'], additionalProperties: false },
  },
  {
    name: 'read_messages',
    description: 'Read the messages DSH sent to this codex (most recent last).',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max messages, default 20.' } }, additionalProperties: false },
  },
  {
    name: 'status',
    description: 'Report the bound DSH session, working directory and codex instance state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  })
  if (!response.ok) throw new Error(`dsh-codex-sidebar bridge: HTTP ${response.status} ${await response.text()}`)
  return await response.json()
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'send_message') {
    const text = String(args.text ?? '')
    if (text.trim() === '') throw new Error('text must not be empty')
    const result = await call('/message', { method: 'POST', body: JSON.stringify({ instance, text }) }) as { messageId: string }
    return `Delivered to DSH (message ${result.messageId}).`
  }
  if (name === 'read_messages') {
    const limit = typeof args.limit === 'number' ? args.limit : 20
    const result = await call(`/inbox?instance=${encodeURIComponent(instance)}&limit=${String(limit)}`) as { messages: { from: string; text: string; at: number }[] }
    return result.messages.length === 0
      ? 'No messages from DSH yet.'
      : result.messages.map((m) => `[${new Date(m.at).toISOString()}] ${m.text}`).join('\n')
  }
  if (name === 'status') {
    const result = await call(`/status?instance=${encodeURIComponent(instance)}`) as Record<string, unknown>
    return JSON.stringify(result)
  }
  throw new Error(`unknown tool "${name}"`)
}

function send(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (line.trim() === '') return
  let request: { id?: number | string; method?: string; params?: Record<string, unknown> }
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  const id = request.id ?? null
  void (async () => {
    try {
      if (request.method === 'initialize') {
        send({ jsonrpc: '2.0', id, result: {
          protocolVersion: (request.params?.protocolVersion as string | undefined) ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'dsh', version: '0.1.0' },
        } })
        return
      }
      if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') return
      if (request.method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return }
      if (request.method === 'tools/list') { send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return }
      if (request.method === 'tools/call') {
        const params = request.params ?? {}
        const text = await callTool(String(params.name ?? ''), (params.arguments ?? {}) as Record<string, unknown>)
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: false } })
        return
      }
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${String(request.method)}` } })
    } catch (error) {
      send({ jsonrpc: '2.0', id, error: { code: -32000, message: (error as Error).message } })
    }
  })()
})
```

4. `src/tools.ts` 先注册 `codex_read`（读 `inboxForDsh`）与 `codex_status`；
   `ctx.tools.register(defineTool({...}))`，用 `exec.agent.session.id` 解析实例。

5. 单测：`tests/mcp-shim.spec.ts` 以子进程方式启动 `lib/codex-mcp.js`（构建后），喂
   `initialize` / `tools/list` / `tools/call`（用一个本地假 HTTP 端点）并断言回包形状；
   `tests/loopback.spec.ts` 断言无 token / 错 token → 401，正确 token → 200。

6. 验证：`pnpm test && pnpm run build`；重载插件；刷新页面；打开 Codex 页签后问 codex
   “你是什么？能联系 DSH 吗？”→ 它应能调用 `mcp__dsh__send_message`，DSH 会话收到消息并被唤醒（A3）。

**Commit**: `feat: loopback bridge, MCP shim and codex -> DSH delivery`

---

## Task 4 — DSH→codex 投递（A4）

**Files**: `src/thread-id.ts`, `src/readiness.ts`, `src/deliver.ts`, `src/tools.ts`,
`tests/thread-id.spec.ts`, `tests/readiness.spec.ts`, `tests/deliver.spec.ts`

**Steps**

1. `src/thread-id.ts`（纯解析 + 文件回退）：
```ts
/** UUIDv7 as printed in codex's status line. */
const UUID_V7 = /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi

/** Last UUIDv7 in the accumulated transcript (the status line redraws it). */
export function threadIdFromTranscript(transcript: string): string | undefined {
  const matches = transcript.match(UUID_V7)
  return matches === null || matches.length === 0 ? undefined : matches[matches.length - 1]?.toLowerCase()
}

/** UUID from a rollout file name: rollout-<ts>-<uuid>.jsonl */
export function threadIdFromRolloutName(name: string): string | undefined {
  const match = /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(name)
  return match?.[1]?.toLowerCase()
}
```

2. `src/readiness.ts`（就绪门；纯函数）：
```ts
/** Markers that mean codex is waiting for the human, not for a message. */
const BLOCK_MARKERS = [
  'Trust this folder?',
  'Do you trust the contents of this directory',
  'Press enter to continue',
  'esc to cancel',
]

export interface ReadinessInput { tail: string; lastOutputAt: number; now: number; quietMs?: number }

/** Whether the composer is idle and free of blocking modals. */
export function isReadyForInjection(input: ReadinessInput): { ready: boolean; reason?: string } {
  const quietMs = input.quietMs ?? 500
  if (input.now - input.lastOutputAt < quietMs) return { ready: false, reason: 'codex is still producing output' }
  const blocked = BLOCK_MARKERS.find((marker) => input.tail.includes(marker))
  if (blocked !== undefined) return { ready: false, reason: `codex is waiting for you (${blocked})` }
  if (!input.tail.includes('›')) return { ready: false, reason: 'codex composer is not visible yet' }
  return { ready: true }
}
```

3. `src/deliver.ts`（策略；`queue` 优先、pty 回退、失败不静默）：
```ts
/**
 * DSH → codex delivery (spec §4.6).
 *
 * 1. threadId known -> `codex queue --thread <id> --message <text>`: proven to
 *    inject into a running TUI without touching the keyboard.
 * 2. otherwise -> bracketed-paste into the pty, gated on isReadyForInjection so
 *    a trust/approval modal can never receive our Enter.
 * 3. both unavailable -> the caller gets the reason; the message stays pending.
 */
import { spawn } from 'node:child_process'
import type { CodexInstance } from './registry.ts'
import { isReadyForInjection } from './readiness.ts'

export interface DeliverToCodexDeps {
  run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>
  now(): number
  quietMs?: number
  waitMs?: number
}

export interface DeliverToCodexResult {
  via: 'queue' | 'pty'
  messageId: string
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

export async function deliverToCodex(
  deps: DeliverToCodexDeps,
  instance: CodexInstance,
  text: string,
  codexPath: string,
): Promise<DeliverToCodexResult> {
  if (instance.threadId !== undefined) {
    const result = await deps.run(codexPath, ['queue', '--thread', instance.threadId, '--message', text])
    if (result.code === 0) {
      return { via: 'queue', messageId: instance.id }
    }
    // Fall through to the pty path; a missing rollout is the expected failure
    // before the first turn, and any other failure must not drop the message.
  }
  const deadline = deps.now() + (deps.waitMs ?? 20_000)
  for (;;) {
    const gate = isReadyForInjection({
      tail: instance.tail,
      lastOutputAt: instance.lastOutputAt,
      now: deps.now(),
      ...(deps.quietMs === undefined ? {} : { quietMs: deps.quietMs }),
    })
    if (gate.ready) break
    if (deps.now() >= deadline) throw new Error(gate.reason ?? 'codex is not ready')
    await sleep(250)
  }
  instance.pty.write(`\u001b[200~${text}\u001b[201~`)
  await sleep(150)
  instance.pty.write('\r')
  return { via: 'pty', messageId: instance.id }
}

/** Production runner for `codex queue`. */
export function runCodex(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => { resolve({ code: -1, stdout, stderr: error.message }) })
    child.on('close', (code) => { resolve({ code: code ?? -1, stdout, stderr }) })
  })
}
```

4. `src/tools.ts` 增加 `codex_send`（解析实例 → `deliverToCodex` → 成功返回 via；失败返回可读原因）
   与 `codex_restart`（state 为 exited/error 时用 `instance.spawn` 重新 `registry.open`）。

5. 单测：threadId 解析（含大小写与多匹配）、就绪门（忙 / 模态 / 未就绪 / 就绪四态）、
   deliver（queue 成功走 queue；queue 失败 + 就绪 → pty 写入 bracketed paste + `\r`；
   模态阻挡 → 抛错且**不写 pty**）。

6. 验证：`pnpm test && pnpm run build`；重载后从 DSH 侧调用 `codex_send("ping from dsh")`
   → codex TUI 出现该消息并开始处理（A4）。

**Commit**: `feat: DSH -> codex delivery (queue first, gated pty fallback)`

---

## Task 5 — 未读角标、状态/重启/结束、失败态与文档（A6）

**Files**: `src/client/state.ts`, `src/client/CodexView.tsx`, `src/client/index.tsx`,
`src/http.ts`, `src/index.ts`, `README.md`

**Steps**

1. `src/http.ts`：fenced 的浏览器 API（`GET /codex-sidebar/api/state?sessionId=`、
   `POST /codex-sidebar/api/seen`、`POST /codex-sidebar/api/restart`、`POST /codex-sidebar/api/kill`），
   全部先过 `isTrustedUpgrade` 同款围栏（HTTP 版：同 Origin/Host 判定）。

2. `src/client/state.ts`：模块级 `Map<sessionId, {unread:number; state:string; threadId?:string; error?:string}>`，
   `poll(sessionId)` 每 3s 拉一次（`document.hidden` 时跳过），`subscribe()` 供 React 使用。

3. `src/client/index.tsx` 的 `badge: (_ctx, scope) => unreadOf(scope.sessionId) || undefined`
   （**廉价**：只读本地 Map，不发请求）。

4. `CodexView` 增加工具栏：状态点（running/exited/error）、`重启`（POST restart）、
   `结束 codex`（POST kill，二次确认）、`清屏`（本地 `term.clear()`）。

5. `README.md`：安装（`dsh plugin --profile web add file:<dir>` 或 npm 名）、行为说明、
   持久语义表（刷新/切对话/关页签/宿主重启）、安全说明（围栏、回环 token、继承 YOLO 配置）、
   已知边界（transcript 1 MiB、`codex queue` 依赖 rollout、TUI 文案变化会导致就绪门降级）、
   codex 版本记录（0.156.1 实测）。

6. 验证：`pnpm run build` + 重载；A6（codex 里 `/quit` → 页签显示 exited + 重启按钮可用）、
   角标（codex 发消息时未聚焦页签显示计数，聚焦后清零）。

**Commit**: `feat: unread badge, status toolbar, failure states and README`

---

## Task 6 — 端到端验收 + 收录

**Steps**

1. 逐条执行 spec §7 的 A1–A7，把每条的**证据**（命令输出、pid/etime、截图要点）追加到
   `docs/aegis/specs/2026-09-24-codex-sidebar-design.md` 的验收表下方，或新建
   `docs/aegis/baseline/2026-09-24-verification.md`。
2. A7 用 curl 探测：
```bash
# 伪造跨站来源应被拒（403/握手失败）
curl -i -s -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Origin: http://evil.example' -H 'Host: 127.0.0.1:9000' \
  http://127.0.0.1:9000/codex-sidebar/ws?sessionId=probe
```
Expected: `403`（或握手被立即销毁）。
3. 写正式 ADR（`docs/aegis/adr/`）：ADR-1 投递 owner、ADR-2 better-sidebar 契约依赖、ADR-3 模型面契约文本。
4. 收录进 collection：在 `dsh-plugins` 里 `git submodule add git@github.com:CBalaa/dsh-codex-sidebar.git plugins/dsh-codex-sidebar`，
   更新 `plugins.json`（name/version/path/repository/origin/description）与 README 的插件表，
   在 collection 提交一条 `add dsh-codex-sidebar (CBalaa own), verified on dsh 0.1.5-rc.1`。
5. 把 profile 安装从 injector 热装配切到正式声明（`dsh plugin --profile web add file:<dir>` 或 npm 名），
   并说明**下次重启**才由 bundles 装配（不强制现在重启）。

**Commit**: `docs: A1-A7 verification evidence, ADRs; collection submodule`

---

## Risks / Rollback

| risk | signal | rollback |
| --- | --- | --- |
| codex TUI 文案变化导致就绪门失效 | 注入被拒或消息留在 pending | 关闭 pty 路径，只用 `codex queue`；文案改为配置项 |
| `codex queue` 语义随版本变化 | `queue` 退出码非 0 且 pty 回退也失败 | 投递策略降级为纯 pty；记录 codex 版本到 README |
| node-pty 在目标机不可用 | 页签显示 spawn 失败原因 | 明确报错（不静默）；文档给出 pnpm rebuild 指引 |
| 围栏误拒 LAN 正常访问 | LAN 打开页签被 403 | `webRuntime.trustedHosts` 已在判定内；补一条 trusted authority 兜底 |
| 插件导致 host 启动失败 | DSH 启动报错 | `dev_uninject_plugin` / 从 profile bundles 移除；本计划全程不重启 host |

**Retirement boundary**: 若 `dsh-better-sidebar` 未来原生提供「按页签指定命令」的终端类型，
本插件的 PTY/WS owner 应退休，只保留通信桥（MCP shim + 工具）。

## Execution Readiness View

```text
Execution Readiness View:
- Intent Lock: 侧栏持久 codex + 与绑定 DSH 会话双向通信（spec §1/§2.1 R1-R8）
- Scope Fence: 只新增 dsh-codex-sidebar 包；不改 better-sidebar/dsh-bridge/DSH 源码
- Baseline Lock: spec 2026-09-24 + initial baseline 2026-09-24
- Approved Behavior: 1:1 绑定 / host 托管 PTY / 继承 ~/.codex 配置 / 自动注入+角标 / 关页签=detach
- Owner / Contract Constraints: 投递归 dsh-bridge；侧栏注册归 better-sidebar；进程归本插件
- Compatibility Boundary: 不写 ~/.codex、不设 CODEX_HOME、不占用 /api 与 /sidebar 命名空间
- Retirement Boundary: better-sidebar 原生支持按页签命令时，PTY owner 退休
- Task Batches: T1 骨架 → T2 PTY/WS → T3 桥 → T4 反向投递 → T5 状态/文档 → T6 验收/收录
- Test Obligations: 围栏/解析/就绪门/argv/策略/MCP 协议单测 + A1-A7 端到端
- Review Gates: T2 与 T4 结束后各做一次只读独立复核（围栏与投递策略）
- Drift / Rewind Rules: 若实现需要改 better-sidebar 或 DSH 源码 → 停下回 spec 评审
- Evidence Required Before Completion: A1-A7 逐条证据 + pnpm test/typecheck/build 输出
- Advisory Boundary: method-pack execution guidance only; not GateDecision, PolicySnapshot, or completion authority
```

## Execution Route

```text
Execution Route:
- Decision: inline
- Evidence: 任务链共享同一批文件与同一运行时（host 进程 + 浏览器），且验收依赖交互式端到端；
  T3/T4 都改 src/tools.ts 与 src/index.ts，拆给并行 subagent 会互相覆盖
- Fallback: T2/T4 结束后用 subagent 做只读独立复核（不写文件）
- User confirmation required: no
```
