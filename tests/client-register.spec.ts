import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { SidebarTabDescriptor } from '../src/better-sidebar.ts'

/**
 * Runs the BUILT client bundle (lib/client.js) inside a fake
 * `window.__ModuleLoader__` + cordis context and asserts the sidebar tab
 * descriptor it registers.
 *
 * This is the only automated check of the browser half that does not need a
 * real browser, and it pins the served artifact rather than the source: the
 * bundle must register the factory under our package id, resolve only baseline
 * externals, and hand `registerTab` a descriptor with the contract fields the
 * sidebar guide requires.
 */
function loadBundle(): { id: string; exports: { apply(ctx: unknown): void } } {
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let id = ''
  let factory: ((require: (specifier: string) => unknown) => { apply(ctx: unknown): void }) | undefined
  const element = (): Record<string, unknown> => ({
    style: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    appendChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
  })
  runInNewContext(code, {
    window: {
      __ModuleLoader__: {
        load(entry: { id: string; factory: typeof factory }) {
          id = entry.id
          factory = entry.factory
        },
      },
      addEventListener() {},
      removeEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
    // xterm is inlined into the bundle, so its module-level browser probing runs
    // here: provide the minimum surface it touches.
    navigator: { userAgent: 'node', platform: 'Linux', language: 'en', languages: ['en'] },
    document: {
      createElement: element,
      querySelector: () => null,
      head: element(),
      body: element(),
      addEventListener() {},
      removeEventListener() {},
    },
    console,
    setTimeout,
    clearTimeout,
  })
  if (factory === undefined) throw new Error('the bundle did not call window.__ModuleLoader__.load')
  const require = (specifier: string): unknown => {
    if (specifier === 'react') return { createElement: () => null, Fragment: null }
    if (specifier === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: null }
    throw new Error(`unexpected external request: ${specifier}`)
  }
  return { id, exports: factory(require) }
}

describe('client bundle', () => {
  it('registers the codex sidebar tab under our package id', () => {
    const registered: SidebarTabDescriptor[] = []
    const disposed: number[] = []
    const { id, exports } = loadBundle()

    const ctx = {
      get: (key: string) =>
        key === 'betterSidebar'
          ? { registerTab: (descriptor: SidebarTabDescriptor) => { registered.push(descriptor); return () => { disposed.push(1) } } }
          : undefined,
      effect: (callback: () => unknown) => { callback() },
    }
    exports.apply(ctx)

    expect(id).toBe('dsh-codex-sidebar')
    expect(registered).toHaveLength(1)
    const descriptor = registered[0]
    if (descriptor === undefined) throw new Error('no descriptor registered')
    expect(descriptor.id).toBe('codex-sidebar:codex')
    expect(descriptor.title).toBe('Codex')
    expect(descriptor.single).toBe(true)
    expect(typeof descriptor.component).toBe('function')
  })

  it('degrades loudly instead of throwing when the sidebar service is absent', () => {
    const errors: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => { errors.push(args) }
    try {
      const { exports } = loadBundle()
      expect(() => { exports.apply({ get: () => undefined, effect: () => undefined }) }).not.toThrow()
    } finally {
      console.error = original
    }
    expect(errors).toHaveLength(1)
  })
})
