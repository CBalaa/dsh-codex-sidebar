/**
 * The xterm theme for the sidebar codex.
 *
 * Provenance: this is the same design-token approach better-sidebar's own
 * terminal uses (`src/client/TerminalView.tsx` → `theme.ts` →
 * `one-dark-palette.ts`). We keep a copy instead of importing that package —
 * the plugin must not depend on it — but the token names, the opacity floor and
 * the curated ANSI hues are deliberately identical, so the codex terminal looks
 * like the built-in terminal in both schemes instead of falling back to
 * xterm's bare defaults (which rendered unreadable inside DSH).
 */
import type { ITheme } from '@xterm/xterm';
/** Whether the app is currently in its dark scheme. */
export declare function isDarkScheme(): boolean;
/** One design token's computed value on <body> ('' before the theme applies). */
export declare function tokenValue(name: string): string;
/** Alpha of a css color, or null when it does not parse as one. */
export declare function colorAlpha(value: string): number | null;
/** A token value that is usable as a surface: present, opaque, not a keyword. */
export declare function effectiveTokenValue(name: string): string;
/** The xterm theme for the current scheme (surface from tokens, ANSI curated). */
export declare function xtermTheme(): ITheme;
/** Re-run `callback` when the app flips its color scheme. */
export declare function subscribeColorScheme(callback: () => void): () => void;
