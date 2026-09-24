/**
 * Minimal structural mirror of dsh-better-sidebar's CLIENT service
 * (`ctx.betterSidebar`). Deliberately NOT a dependency: the service shape is
 * consumed at runtime and checked by `supportsTabs()` before use, so a sidebar
 * upgrade that drops `registerTab` degrades to "no tab + loud log" instead of a
 * build break (and we avoid pulling mermaid/codemirror in for a type).
 *
 * Field semantics follow dsh-better-sidebar/docs/external-plugin-guide.md §4:
 * `id` is also the tab's `type`; `single: true` ≡ `dedupeKey: () => id`;
 * `badge` runs on every tab-bar render (must stay cheap).
 */
import type { ReactNode } from 'react'

export interface SidebarSessionScope {
  sessionId: string
  cwd?: string
}

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
  /** True only while this tab is the active, visible page. */
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
