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

/**
 * Virtual id for one stylesheet. The real path is base64url-encoded because a
 * virtual id ending in `.css` makes tsdown demand the optional `@tsdown/css`
 * pipeline — we inline the text ourselves instead.
 */
function cssVirtualId(file: string): string {
  return CSS_VIRTUAL_PREFIX + Buffer.from(file, 'utf8').toString('base64url')
}

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
        return cssVirtualId(require.resolve(source, { paths: [importer] }))
      }
      return cssVirtualId(require.resolve(source))
    },
    load(id: string) {
      if (!id.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const file = Buffer.from(id.slice(CSS_VIRTUAL_PREFIX.length), 'base64url').toString('utf8')
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
