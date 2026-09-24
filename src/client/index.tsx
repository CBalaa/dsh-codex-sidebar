/**
 * dsh-codex-sidebar — client half. Registers the sidebar tab.
 *
 * The service is resolved defensively (`ctx.get`) so a missing or older
 * better-sidebar cannot break the whole client activation. The descriptor is
 * registered inside `ctx.effect` so HMR/disable revokes it (a leftover
 * registration throws "already registered" on the next activation).
 */
import type { Context } from '@deepseek-ai/cordis'
import { supportsTabs } from '../better-sidebar.ts'
import { CodexView } from './CodexView.tsx'

export const inject = ['betterSidebar']

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
      component: (props) => <CodexView {...props} />,
    }),
  )
}
