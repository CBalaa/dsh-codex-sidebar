/**
 * The identity context injected into every sidebar-codex (spec §4.4).
 *
 * This text is a MODEL-FACING CONTRACT: changing it changes what codex believes
 * about itself and about the `dsh` MCP tools it can call. Keep it in sync with
 * the tool names in src/tools.ts / src/mcp-shim.ts and with the spec.
 */
export declare function identityText(input: {
    sessionId: string;
    cwd: string;
}): string;
