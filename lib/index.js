import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { accessSync, chmodSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
//#region src/to-dsh.ts
/** Deliver one codex message into the bound DSH session. */
async function deliverToDsh(deps, instance, text) {
	const from = `codex:${instance.id}`;
	if (deps.bridge !== void 0) {
		await deps.bridge.deliverExternal(from, instance.sessionId, text, { transport: "codex" });
		return;
	}
	const agent = deps.agents?.get(instance.sessionId);
	if (agent === void 0) throw new Error("dsh-bridge is unavailable and the bound session is not live");
	deps.log?.warn("dsh-bridge unavailable: falling back to a direct agent.followup (no audit record)");
	agent.followup({
		id: crypto.randomUUID(),
		role: "user",
		content: [{
			type: "text",
			text: `[codex-sidebar ${instance.id}] ${text}`
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-codex-sidebar",
			form: "codex"
		}
	});
}
//#endregion
//#region src/loopback.ts
/**
* The loopback bridge the codex-side MCP shim talks to.
*
* Why not a route on the DSH webserver: `dsh-auth-gate` wraps EVERY route and
* upgrade the webserver exposes (src/gate/guard.ts wraps existing + future
* registrations), so a headless MCP server inside codex could never pass its
* authentication. Instead this plugin runs its own server bound to 127.0.0.1 on
* an OS-assigned port, with a per-instance bearer token handed to the shim
* through the spawn environment (never in argv, never on disk).
*/
function json$1(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(body)
	});
	res.end(body);
}
async function readBody$1(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	if (chunks.length === 0) return {};
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return;
	}
}
function createLoopback(input) {
	const tokens = /* @__PURE__ */ new Map();
	let base = "";
	const instanceOf = (id) => typeof id === "string" && id !== "" ? input.registry.getById(id) : void 0;
	const authorized = (req, instance) => {
		const header = req.headers.authorization;
		if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
		const presented = header.slice(7);
		const expected = instance === void 0 ? void 0 : tokens.get(instance.id);
		return expected !== void 0 && expected === presented;
	};
	const server = createServer((req, res) => {
		(async () => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			const instanceId = url.searchParams.get("instance") ?? void 0;
			let body = {};
			if (req.method === "POST") {
				const parsed = await readBody$1(req);
				if (parsed === void 0 || typeof parsed !== "object" || parsed === null) {
					json$1(res, 400, { error: "invalid JSON body" });
					return;
				}
				body = parsed;
			}
			const instance = instanceOf(req.method === "POST" ? body.instance ?? instanceId : instanceId);
			if (instance === void 0) {
				json$1(res, 404, { error: "unknown codex instance" });
				return;
			}
			if (!authorized(req, instance)) {
				json$1(res, 401, { error: "unauthorized" });
				return;
			}
			if (req.method === "POST" && url.pathname === "/message") {
				const text = typeof body.text === "string" ? body.text : "";
				if (text.trim() === "") {
					json$1(res, 400, { error: "text must not be empty" });
					return;
				}
				try {
					await deliverToDsh(input.deps, instance, text);
				} catch (error) {
					json$1(res, 502, { error: error.message });
					return;
				}
				json$1(res, 200, {
					ok: true,
					messageId: input.registry.recordToDsh(instance, text).id
				});
				return;
			}
			if (req.method === "GET" && url.pathname === "/inbox") {
				const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? "20") || 20));
				json$1(res, 200, { messages: instance.inboxForCodex.slice(-limit) });
				return;
			}
			if (req.method === "GET" && url.pathname === "/status") {
				json$1(res, 200, {
					instanceId: instance.id,
					sessionId: instance.sessionId,
					cwd: instance.cwd,
					state: instance.state,
					threadId: instance.threadId ?? null
				});
				return;
			}
			json$1(res, 404, { error: "not found" });
		})().catch((error) => {
			json$1(res, 500, { error: error.message });
		});
	});
	return {
		ready: new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (address === null || typeof address === "string") {
					reject(/* @__PURE__ */ new Error("loopback server did not bind a TCP port"));
					return;
				}
				base = `http://127.0.0.1:${String(address.port)}`;
				resolve();
			});
		}),
		url: () => base,
		tokenFor(instanceId) {
			const existing = tokens.get(instanceId);
			if (existing !== void 0) return existing;
			const token = randomBytes(32).toString("hex");
			tokens.set(instanceId, token);
			return token;
		},
		close() {
			return new Promise((resolve) => {
				for (const instance of input.registry.list()) tokens.delete(instance.id);
				server.close(() => {
					resolve();
				});
				server.closeAllConnections();
			});
		}
	};
}
//#endregion
//#region src/pty-deps.ts
/**
* node-pty loading, kept out of the module graph until first use so a machine
* without the native module still activates the plugin (the tab then reports a
* readable spawn error instead of the whole host failing).
*/
let cached = null;
/**
* Restore the executable bit pnpm strips from node-pty's spawn-helper (the
* macOS helper that forks and sets up the pty). Without it every spawn fails
* with `posix_spawnp failed`. Same fix better-sidebar applies at activation
* (src/pty-manager.ts:27-44), kept here because a link-installed deployment
* never runs node-pty's own postinstall.
*/
function ensureSpawnHelper() {
	if (process.platform === "win32") return;
	try {
		const entry = createRequire(import.meta.url).resolve("node-pty");
		const root = dirname(dirname(entry));
		for (const helper of [join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"), join(root, "build", "Release", "spawn-helper")]) if (existsSync(helper)) chmodSync(helper, 493);
	} catch {}
}
/** Load node-pty once; throws a readable error when the native module is absent. */
async function loadNodePty() {
	if (cached !== null) return cached;
	ensureSpawnHelper();
	try {
		const mod = await import("node-pty");
		cached = mod;
		return mod;
	} catch (error) {
		throw new Error(`node-pty is unavailable (${error.message}). Run \`pnpm install\` (or \`pnpm rebuild node-pty\`) in the dsh-codex-sidebar package.`);
	}
}
//#endregion
//#region src/identity.ts
/**
* The identity context injected into every sidebar-codex (spec §4.4).
*
* This text is a MODEL-FACING CONTRACT: changing it changes what codex believes
* about itself and about the `dsh` MCP tools it can call. Keep it in sync with
* the tool names in src/tools.ts / src/mcp-shim.ts and with the spec.
*/
function identityText(input) {
	return [
		"You are running as a \"sidebar-codex\" inside DeepSeek Harness (DSH).",
		`- Bound DSH session: ${input.sessionId}; working directory: ${input.cwd}. You do NOT share that`,
		"  conversation's context; it never sees your transcript unless you send it.",
		"- You can talk to DSH through the MCP server `dsh`:",
		"  `mcp__dsh__send_message` (deliver text to the bound DSH session; it wakes that agent),",
		"  `mcp__dsh__read_messages` (read messages DSH sent to you),",
		"  `mcp__dsh__status` (bound session id/title/cwd).",
		"- Messages from DSH arrive as user messages; DSH identifies itself in the envelope.",
		"- Prefer answering the user in this TUI; use `send_message` when DSH needs the result."
	].join("\n");
}
//#endregion
//#region src/spawn.ts
/**
* codex argv/env assembly. Pure (no I/O, no process state) so the exact
* injection contract is unit-testable.
*
* What is injected, and what deliberately is NOT:
* - `-c developer_instructions=...` carries our identity text; when the user's
*   own config.toml sets developer_instructions we APPEND theirs instead of
*   clobbering it.
* - `-c mcp_servers.dsh.*` registers the bridge MCP server for this instance
*   only (no config.toml write, no CODEX_HOME override).
* - approval_policy / sandbox_mode are NOT touched: the sidebar codex behaves
*   exactly like the user's terminal codex (approved decision 2026-09-24).
*/
/** Render a flat string map as a TOML inline table (codex parses `-c` values as TOML). */
function tomlInlineTable(values) {
	return `{${Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ")}}`;
}
/** Build the codex argv/env for one instance. */
function buildSpawnPlan(input) {
	const instructions = [identityText({
		sessionId: input.sessionId,
		cwd: input.cwd
	})];
	if (input.userDeveloperInstructions !== void 0 && input.userDeveloperInstructions !== "") instructions.push(input.userDeveloperInstructions);
	const args = [
		"-c",
		`developer_instructions=${JSON.stringify(instructions.join("\n\n"))}`,
		"-c",
		`mcp_servers.dsh.command=${JSON.stringify(input.nodePath)}`,
		"-c",
		`mcp_servers.dsh.args=${JSON.stringify([input.shimPath])}`,
		"-c",
		`mcp_servers.dsh.env=${tomlInlineTable({
			DSH_CODEX_URL: input.loopbackUrl,
			DSH_CODEX_TOKEN: input.loopbackToken,
			DSH_CODEX_INSTANCE: input.instanceId,
			DSH_CODEX_SESSION: input.sessionId
		})}`
	];
	return {
		file: input.codexPath,
		args,
		env: {
			...process.env,
			TERM: "xterm-256color",
			DSH_CODEX_INSTANCE: input.instanceId
		},
		cwd: input.cwd
	};
}
//#endregion
//#region src/registry.ts
/**
* The codex instance registry — the ONLY owner of codex processes in this host.
*
* One instance per DSH session (1:1 binding, approved 2026-09-24). The registry
* owns the pty, the bounded transcript used for reconnect replay, the last-output
* tail used by the readiness gate, and the two message inboxes.
*
* Lifecycle (mirrors better-sidebar's terminal semantics where they apply):
* - a bare socket drop (page refresh) schedules a close after the grace window;
*   a reconnect cancels it, so the SAME codex survives a refresh;
* - `park` (conversation switch) keeps the process alive indefinitely;
* - `close` (tab closed) is a DETACH: the view goes away, codex keeps running;
* - explicit `dispose`/`disposeAll` (toolbar "stop", plugin teardown) kills it.
*/
/** Bytes kept for transcript replay (same bound as better-sidebar's terminal). */
const TRANSCRIPT_LIMIT = 1 << 20;
var CodexRegistry = class {
	options;
	bySession = /* @__PURE__ */ new Map();
	byId = /* @__PURE__ */ new Map();
	constructor(options) {
		this.options = options;
	}
	list() {
		return [...this.byId.values()];
	}
	get(sessionId) {
		return this.bySession.get(sessionId);
	}
	getById(id) {
		return this.byId.get(id);
	}
	/**
	* Get-or-create the session's codex. A live instance is reused (and its
	* pending close cancelled) so reconnects and re-opens land on the same
	* process; an exited one is replaced.
	*/
	async open(spawn, size) {
		const existing = this.bySession.get(spawn.sessionId);
		if (existing !== void 0 && existing.state === "running") {
			this.cancelClose(existing.id);
			existing.parked = false;
			return existing;
		}
		if (existing !== void 0) this.dispose(existing.id);
		return await this.create(spawn, size);
	}
	async create(spawn, size) {
		const plan = this.options.plan(spawn);
		let pty;
		try {
			pty = await this.options.spawnPty(plan, size);
		} catch (error) {
			throw error;
		}
		const now = this.options.now ?? Date.now;
		const instance = {
			id: spawn.instanceId,
			sessionId: spawn.sessionId,
			cwd: spawn.cwd,
			spawn,
			pty,
			transcript: "",
			tail: "",
			state: "running",
			unread: 0,
			inboxForCodex: [],
			inboxForDsh: [],
			parked: false,
			spawnAt: now(),
			lastOutputAt: now()
		};
		pty.onData((data) => {
			instance.transcript += data;
			if (instance.transcript.length > 1048576) instance.transcript = instance.transcript.slice(instance.transcript.length - TRANSCRIPT_LIMIT);
			instance.tail = (instance.tail + data).slice(-4096);
			instance.lastOutputAt = now();
			this.options.onData?.(instance, data);
		});
		pty.onExit(({ exitCode }) => {
			instance.state = "exited";
			instance.exitCode = exitCode;
		});
		this.bySession.set(instance.sessionId, instance);
		this.byId.set(instance.id, instance);
		return instance;
	}
	/** Record a codex → DSH message (bumps the unread badge). */
	recordToDsh(instance, text) {
		const message = {
			id: randomUUID(),
			from: "codex",
			text,
			at: (this.options.now ?? Date.now)()
		};
		instance.inboxForDsh.push(message);
		if (instance.inboxForDsh.length > 200) instance.inboxForDsh.shift();
		instance.unread += 1;
		return message;
	}
	/** Record a DSH → codex message (the MCP shim reads this inbox). */
	recordToCodex(instance, text) {
		const message = {
			id: randomUUID(),
			from: "dsh",
			text,
			at: (this.options.now ?? Date.now)()
		};
		instance.inboxForCodex.push(message);
		if (instance.inboxForCodex.length > 200) instance.inboxForCodex.shift();
		return message;
	}
	markSeen(sessionId) {
		const instance = this.bySession.get(sessionId);
		if (instance !== void 0) instance.unread = 0;
	}
	park(id) {
		const instance = this.byId.get(id);
		if (instance === void 0) return;
		this.cancelClose(id);
		instance.parked = true;
	}
	/** Schedule destruction after `delayMs` (0 = now); `open()` cancels it. */
	scheduleClose(id, delayMs) {
		const instance = this.byId.get(id);
		if (instance === void 0) return;
		this.cancelClose(id);
		instance.closeTimer = setTimeout(() => {
			this.dispose(id);
		}, delayMs);
	}
	cancelClose(id) {
		const instance = this.byId.get(id);
		if (instance?.closeTimer !== void 0) {
			clearTimeout(instance.closeTimer);
			instance.closeTimer = void 0;
		}
	}
	dispose(id) {
		const instance = this.byId.get(id);
		if (instance === void 0) return;
		this.cancelClose(id);
		this.bySession.delete(instance.sessionId);
		this.byId.delete(id);
		try {
			instance.pty.kill();
		} catch {}
	}
	disposeAll() {
		for (const id of [...this.byId.keys()]) this.dispose(id);
	}
};
/** Production spawn: node-pty with an xterm-256color terminal. */
async function spawnCodexPty(plan, size) {
	return (await loadNodePty()).spawn(plan.file, plan.args, {
		name: "xterm-256color",
		cols: Math.max(2, Math.floor(size.cols)),
		rows: Math.max(2, Math.floor(size.rows)),
		cwd: plan.cwd,
		env: plan.env
	});
}
/** The production registry options. */
function productionOptions() {
	return {
		plan: buildSpawnPlan,
		spawnPty: spawnCodexPty
	};
}
//#endregion
//#region src/readiness.ts
/**
* The readiness gate for pty injection (spec §4.6).
*
* Writing keystrokes into a TUI is only safe when codex is sitting at its
* composer. If a modal is up (the folder trust prompt, an approval prompt) our
* `Enter` would answer that modal instead of submitting a message — so the gate
* refuses and the caller keeps the message pending with a readable reason.
*
* The composer marker `›` was observed live in codex 0.156.1 (see
* tests/pty-smoke.spec.ts); every marker here is a heuristic on purpose, and a
* failed heuristic degrades to "message stays pending", never to a wrong Enter.
*/
/** Markers that mean codex is waiting for the human, not for a message. */
const BLOCK_MARKERS = [
	"Trust this folder?",
	"Do you trust the contents of this directory",
	"Press enter to continue",
	"esc to cancel",
	"Allow command?"
];
/** Whether the composer is idle and free of blocking modals. */
function isReadyForInjection(input) {
	const quietMs = input.quietMs ?? 500;
	if (input.now - input.lastOutputAt < quietMs) return {
		ready: false,
		reason: "codex is still producing output"
	};
	const visible = plainText(input.tail);
	const blocked = BLOCK_MARKERS.find((marker) => visible.includes(marker));
	if (blocked !== void 0) return {
		ready: false,
		reason: `codex is waiting for you (${blocked})`
	};
	if (!visible.includes("›")) return {
		ready: false,
		reason: "codex composer is not visible yet"
	};
	return { ready: true };
}
/**
* Flatten a raw pty stream into matchable text.
*
* codex does not print its screens as plain lines: it draws each WORD with a
* cursor-positioning escape (`Trust\u001b[5;9Hthis\u001b[5;14Hfolder?`), so a raw
* `includes('Trust this folder?')` never matches and a naive ANSI strip yields
* `Trustthisfolder?`. Replacing every escape with a space and collapsing runs
* reconstructs the visible text closely enough for marker matching.
*/
function plainText(value) {
	return value.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g, " ").replace(/\s+/g, " ").trim();
}
/**
* Whitespace-insensitive comparison key.
*
* codex positions every WIDE character (CJK) with its own cursor move, so
* `plainText` yields `这 是 一 条 …` for a Chinese message, and a wrapped line
* inserts a gap too. Squeezing all whitespace out of both sides makes the
* comparison independent of both effects.
*/
function squeeze(value) {
	return value.replace(/\s+/g, "");
}
/**
* Did the pasted text actually land in the composer?
*
* This is the second half of the safety story, and it exists because codex
* paints its composer FIRST and only later (seconds later, observed live) clears
* the screen for a modal such as `Trust this folder?`. A readiness check alone
* therefore cannot prevent the race — the paste is what proves it: a modal
* swallows the paste, the composer echoes it. We only press Enter on an echo.
*
* `probeChars` keeps the check robust against wrapping and redraws.
*/
function pasteLanded(tail, text, probeChars = 32) {
	const probe = squeeze((text.split("\n")[0] ?? "").slice(0, Math.max(8, probeChars)));
	if (probe === "") return false;
	return squeeze(plainText(tail)).includes(probe);
}
//#endregion
//#region src/deliver.ts
/**
* DSH → codex delivery (spec §4.6).
*
* 1. threadId known → `codex queue --thread <id> --message <text>`: the clean
*    path, proven against codex 0.156.1 to inject into a running TUI without
*    touching the keyboard (it needs an existing rollout, so it fails before the
*    first turn — that failure is expected and falls through).
* 2. otherwise → bracketed paste into the pty, gated by `isReadyForInjection`
*    so a trust/approval modal can never receive our Enter.
* 3. both unavailable → the caller gets the reason; nothing is silently dropped.
*/
const defaultSleep = (ms) => new Promise((resolve) => {
	setTimeout(resolve, ms);
});
/** Deliver one message into the codex TUI. Throws with a readable reason. */
async function deliverToCodex(deps, instance, text, codexPath) {
	const sleep = deps.sleep ?? defaultSleep;
	const failures = [];
	if (instance.threadId !== void 0) {
		const result = await deps.run(codexPath, [
			"queue",
			"--thread",
			instance.threadId,
			"--message",
			text
		]);
		if (result.code === 0) return {
			via: "queue",
			detail: result.stdout.trim()
		};
		failures.push(`codex queue failed (exit ${String(result.code)}): ${(result.stderr || result.stdout).trim()}`);
	} else failures.push("no codex thread id yet (queue needs an existing rollout)");
	if (instance.state !== "running") throw new Error(`codex is not running (${instance.state})`);
	const deadline = deps.now() + (deps.waitMs ?? 2e4);
	let reason = "codex is not ready";
	for (let attempt = 0; attempt < 400; attempt += 1) {
		const gate = isReadyForInjection({
			tail: instance.tail,
			lastOutputAt: instance.lastOutputAt,
			now: deps.now(),
			...deps.quietMs === void 0 ? {} : { quietMs: deps.quietMs }
		});
		if (gate.ready) break;
		reason = gate.reason ?? reason;
		if (deps.now() >= deadline) {
			failures.push(reason);
			throw new Error(`could not deliver to codex: ${failures.join("; ")}`);
		}
		await sleep(250);
	}
	instance.pty.write(`\u001b[200~${text}\u001b[201~`);
	const confirmDeadline = deps.now() + (deps.confirmMs ?? 2e3);
	for (;;) {
		if (pasteLanded(instance.tail, text)) break;
		if (deps.now() >= confirmDeadline) {
			const blocked = BLOCK_MARKERS.find((marker) => instance.tail.includes(marker));
			failures.push(blocked === void 0 ? "codex did not echo the pasted text (a modal or full-screen view may be open)" : `codex is waiting for you (${blocked}); nothing was submitted`);
			throw new Error(`could not deliver to codex: ${failures.join("; ")}`);
		}
		await sleep(150);
	}
	await sleep(150);
	instance.pty.write("\r");
	return {
		via: "pty",
		detail: failures.join("; ")
	};
}
/** Production runner for `codex queue`. */
function runCodex(command, args) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { env: process.env });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			resolve({
				code: -1,
				stdout,
				stderr: error.message
			});
		});
		child.on("close", (code) => {
			resolve({
				code: code ?? -1,
				stdout,
				stderr
			});
		});
	});
}
//#endregion
//#region src/thread-id.ts
/**
* Discovery of codex's own thread id, which `codex queue --thread <id>` needs.
*
* Two strategies, both pure parsers here so they are unit-testable:
* 1. the UUIDv7 codex prints in its TUI status line (scanned from the bounded
*    transcript — the status line is redrawn, so the LAST match wins);
* 2. the rollout file name codex writes under $CODEX_HOME/sessions once a turn
*    has happened (`rollout-<timestamp>-<uuid>.jsonl`).
*
* When neither yields an id the delivery path falls back to pty injection.
*/
/** UUIDv7 as printed by codex (version nibble 7, RFC 4122 variant). */
const UUID_V7 = /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
/** The last UUIDv7 in the accumulated transcript, lowercased. */
function threadIdFromTranscript(transcript) {
	const matches = transcript.match(UUID_V7);
	if (matches === null || matches.length === 0) return void 0;
	return matches[matches.length - 1]?.toLowerCase();
}
/** The UUID embedded in a rollout file name. */
function threadIdFromRolloutName(name) {
	return /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(name)?.[1]?.toLowerCase();
}
/** Parse the `session_meta` line (the first line) of a rollout file. */
function parseRolloutMeta(firstLine) {
	try {
		const parsed = JSON.parse(firstLine);
		if (parsed.type !== "session_meta" || parsed.payload === void 0) return void 0;
		return parsed.payload;
	} catch {
		return;
	}
}
/** The default `$CODEX_HOME/sessions` directory. */
async function defaultSessionsDir() {
	const { homedir } = await import("node:os");
	const { join } = await import("node:path");
	return join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
}
/**
* Fallback discovery of THIS instance's thread id.
*
* `codex queue --thread <id>` is the clean delivery path, but the id is only
* printed in the TUI status line — which a narrow sidebar truncates. So we also
* look for the rollout codex wrote for this session.
*
* Safety matters more than availability here: queueing into the WRONG thread
* would inject a message into somebody else's codex session. Candidates are
* therefore filtered to rollout files written after this instance spawned whose
* `session_meta` names the same cwd and a top-level `cli` source, and we only
* answer when the match is unique (or the newest leads the runner-up by a clear
* margin). Anything ambiguous returns undefined and the caller falls back to the
* readiness-gated pty path.
*/
async function discoverThreadIdFromRollouts(input) {
	const { readdir, stat, open } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const slack = input.slackMs ?? 5e3;
	const minLead = input.minLeadMs ?? 2e3;
	const candidates = [];
	/** Only the first line matters: read a bounded head, never the whole file. */
	const readMeta = async (file) => {
		const handle = await open(file, "r");
		try {
			const buffer = Buffer.alloc(16384);
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
			return parseRolloutMeta(buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "");
		} catch {
			return;
		} finally {
			await handle.close();
		}
	};
	const walk = async (dir, depth) => {
		if (depth > 4) return;
		let entries;
		try {
			entries = await readdir(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			const info = await stat(full).catch(() => void 0);
			if (info === void 0) continue;
			if (info.isDirectory()) {
				await walk(full, depth + 1);
				continue;
			}
			if (info.mtimeMs + slack < input.spawnedAt) continue;
			const nameId = threadIdFromRolloutName(entry);
			if (nameId === void 0) continue;
			const meta = await readMeta(full);
			if (meta === void 0) continue;
			if (typeof meta.id !== "string" || meta.id.toLowerCase() !== nameId) continue;
			if (input.cwd !== void 0 && meta.cwd !== input.cwd) continue;
			if (meta.source !== "cli") continue;
			candidates.push({
				id: nameId,
				mtimeMs: info.mtimeMs
			});
		}
	};
	await walk(input.sessionsDir, 0);
	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
	const newest = candidates[0];
	if (newest === void 0) return void 0;
	const runnerUp = candidates[1];
	if (runnerUp !== void 0 && newest.mtimeMs - runnerUp.mtimeMs < minLead) return void 0;
	return newest.id;
}
//#endregion
//#region src/tools.ts
/**
* Thread id for the clean `codex queue` path: the TUI status line only shows it
* when the sidebar is wide enough, so fall back to the rollout codex wrote for
* this session (cwd-matched and uniqueness-checked — see thread-id.ts).
*/
async function resolveThreadId(deps, instance) {
	if (instance.threadId !== void 0) return;
	const found = await (deps.discoverThreadId ?? (async (target) => await discoverThreadIdFromRollouts({
		sessionsDir: await defaultSessionsDir(),
		spawnedAt: target.spawnAt,
		cwd: target.cwd
	})))(instance).catch(() => void 0);
	if (found !== void 0) instance.threadId = found;
}
const text = (value) => [{
	type: "text",
	text: value
}];
function instanceOf(deps, exec) {
	const sessionId = exec.agent?.session.id;
	if (sessionId === void 0 || sessionId === "") throw new Error("this tool needs an owning agent session");
	const instance = deps.registry.get(sessionId);
	if (instance === void 0) throw new Error("no codex is bound to this session yet — open the Codex tab in the right sidebar first");
	return instance;
}
function tailOf(instance, maxChars = 1200) {
	const visible = plainText(instance.tail);
	return visible.length <= maxChars ? visible : visible.slice(visible.length - maxChars);
}
function createCodexTools(deps) {
	const now = deps.now ?? Date.now;
	return [
		{
			name: "codex_send",
			description: "Send a message to the codex session bound to this conversation (the Codex tab in the right sidebar). codex treats it as a user message and starts working on it. Fails with a readable reason when no codex is bound or codex is waiting for the human.",
			parameters: {
				type: "object",
				properties: { text: {
					type: "string",
					description: "Message text to deliver to codex."
				} },
				required: ["text"],
				additionalProperties: false
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						via: {
							type: "string",
							description: "'queue' or 'pty'."
						},
						detail: {
							type: "string",
							description: "Runner output or the reason the queue path was skipped."
						}
					},
					required: ["via"]
				},
				render: (_args, value) => text(`Delivered to codex via ${value.via}.`)
			},
			async execute(args, exec) {
				const { text: message } = args;
				if (typeof message !== "string" || message.trim() === "") throw new Error("text must not be empty");
				const instance = instanceOf(deps, exec);
				await resolveThreadId(deps, instance);
				const result = await (deps.deliver ?? deliverToCodex)({
					run: runCodex,
					now
				}, instance, message, deps.codexPath);
				deps.registry.recordToCodex(instance, message);
				return result;
			}
		},
		{
			name: "codex_read",
			description: "Read the messages codex sent to this conversation (most recent last), plus the current codex state. Messages are also delivered into the conversation automatically; this tool is for re-reading them.",
			parameters: {
				type: "object",
				properties: { limit: {
					type: "number",
					description: "Maximum messages, default 20."
				} },
				additionalProperties: false
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						state: { type: "string" },
						messages: {
							type: "array",
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									at: { type: "number" },
									text: { type: "string" }
								},
								required: ["at", "text"]
							}
						}
					},
					required: ["state", "messages"]
				},
				render: (_args, value) => {
					const payload = value;
					if (payload.messages.length === 0) return text(`codex is ${payload.state}; no messages from codex yet.`);
					return text([`codex is ${payload.state}; ${String(payload.messages.length)} message(s):`, ...payload.messages.map((m) => `[${new Date(m.at).toISOString()}] ${m.text}`)].join("\n"));
				}
			},
			async execute(args, exec) {
				const { limit } = args;
				const instance = instanceOf(deps, exec);
				const count = typeof limit === "number" && limit > 0 ? Math.min(100, Math.floor(limit)) : 20;
				return {
					state: instance.state,
					messages: instance.inboxForDsh.slice(-count).map((message) => ({
						at: message.at,
						text: message.text
					}))
				};
			}
		},
		{
			name: "codex_status",
			description: "Report the codex session bound to this conversation: process state, codex thread id, working directory, unread count and the tail of its terminal output.",
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						state: { type: "string" },
						instanceId: { type: "string" },
						threadId: { type: "string" },
						cwd: { type: "string" },
						unread: { type: "number" },
						exitCode: { type: "number" },
						tail: { type: "string" }
					},
					required: [
						"state",
						"instanceId",
						"cwd",
						"unread"
					]
				},
				render: (_args, value) => {
					const payload = value;
					return text([
						`codex: ${payload.state}${payload.threadId === void 0 ? "" : ` (thread ${payload.threadId})`}`,
						`cwd: ${payload.cwd}`,
						payload.tail === void 0 || payload.tail === "" ? "" : `--- terminal tail ---\n${payload.tail}`
					].filter((line) => line !== "").join("\n"));
				}
			},
			async execute(_args, exec) {
				const instance = instanceOf(deps, exec);
				return {
					state: instance.state,
					instanceId: instance.id,
					...instance.threadId === void 0 ? {} : { threadId: instance.threadId },
					cwd: instance.cwd,
					unread: instance.unread,
					...instance.exitCode === void 0 ? {} : { exitCode: instance.exitCode },
					tail: tailOf(instance)
				};
			}
		},
		{
			name: "codex_restart",
			description: "Restart the codex process bound to this conversation after it exited (same working directory and injection). A running codex is left untouched.",
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						restarted: { type: "boolean" },
						state: { type: "string" },
						instanceId: { type: "string" }
					},
					required: [
						"restarted",
						"state",
						"instanceId"
					]
				},
				render: (_args, value) => {
					const payload = value;
					return text(payload.restarted ? "codex restarted." : `codex is already ${payload.state}; nothing to do.`);
				}
			},
			async execute(_args, exec) {
				const instance = instanceOf(deps, exec);
				if (instance.state === "running") return {
					restarted: false,
					state: instance.state,
					instanceId: instance.id
				};
				const prepared = await deps.prepare(instance.sessionId);
				const fresh = await deps.registry.open({
					...prepared.spawn,
					sessionId: instance.sessionId,
					cwd: instance.cwd
				}, {
					cols: 80,
					rows: 24
				});
				return {
					restarted: true,
					state: fresh.state,
					instanceId: fresh.id
				};
			}
		}
	];
}
//#endregion
//#region src/trust-fence.ts
/** Strip the port (and IPv6 brackets) from a Host/authority value. */
function hostnameOf(authority) {
	const value = authority.trim();
	if (value.startsWith("[")) {
		const end = value.indexOf("]");
		return end === -1 ? value : value.slice(1, end);
	}
	const colon = value.lastIndexOf(":");
	return colon === -1 ? value : value.slice(0, colon);
}
/** Whether a hostname is a loopback literal. */
function isLoopbackHost(hostname) {
	if (hostname === "localhost" || hostname === "::1") return true;
	const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
	if (match === null) return false;
	const octets = match.slice(1).map(Number);
	return octets.every((part) => part <= 255) && octets[0] === 127;
}
/** Whether a request may reach the codex terminal / codex API. */
function isTrustedRequest(req, trustedHosts) {
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const host = req.headers.host;
	if (typeof host !== "string" || host === "") return false;
	const hostname = hostnameOf(host);
	const origin = req.headers.origin;
	if (typeof origin === "string" && origin !== "" && origin !== "null") {
		let originHost;
		try {
			originHost = new URL(origin).hostname;
		} catch {
			return false;
		}
		if (originHost !== hostname) return false;
	}
	if (isLoopbackHost(hostname)) return true;
	return trustedHosts.includes(hostname) || trustedHosts.includes(host);
}
//#endregion
//#region src/http.ts
function json(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(body)
	});
	res.end(body);
}
async function readBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	if (chunks.length === 0) return {};
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}
function createCodexHttp(deps) {
	return { handle(req, res) {
		(async () => {
			if (!deps.isTrusted(req)) {
				json(res, 403, { error: "forbidden" });
				return;
			}
			const url = new URL(req.url ?? "/", "http://dsh.internal");
			const querySession = url.searchParams.get("sessionId") ?? "";
			const body = req.method === "POST" ? await readBody(req) : {};
			const sessionId = typeof body.sessionId === "string" && body.sessionId !== "" ? body.sessionId : querySession;
			if (req.method === "GET" && url.pathname === "/codex-sidebar/api/state") {
				if (sessionId === "") {
					json(res, 400, { error: "sessionId is required" });
					return;
				}
				const instance = deps.registry.get(sessionId);
				json(res, 200, {
					bound: instance !== void 0,
					instanceId: instance?.id ?? null,
					state: instance?.state ?? "none",
					threadId: instance?.threadId ?? null,
					cwd: instance?.cwd ?? null,
					unread: instance?.unread ?? 0,
					exitCode: instance?.exitCode ?? null
				});
				return;
			}
			if (req.method === "POST" && url.pathname === "/codex-sidebar/api/seen") {
				if (sessionId !== "") deps.registry.markSeen(sessionId);
				json(res, 200, { ok: true });
				return;
			}
			if (req.method === "POST" && url.pathname === "/codex-sidebar/api/restart") {
				const instance = deps.registry.get(sessionId);
				if (instance === void 0) {
					json(res, 404, { error: "no codex is bound to this session" });
					return;
				}
				if (instance.state === "running") {
					json(res, 200, {
						ok: true,
						restarted: false,
						state: instance.state
					});
					return;
				}
				const prepared = await deps.prepare(sessionId);
				json(res, 200, {
					ok: true,
					restarted: true,
					instanceId: (await deps.registry.open({
						...prepared.spawn,
						sessionId,
						cwd: instance.cwd
					}, {
						cols: 80,
						rows: 24
					})).id
				});
				return;
			}
			if (req.method === "POST" && url.pathname === "/codex-sidebar/api/kill") {
				const instance = deps.registry.get(sessionId);
				if (instance === void 0) {
					json(res, 404, { error: "no codex is bound to this session" });
					return;
				}
				deps.registry.dispose(instance.id);
				json(res, 200, { ok: true });
				return;
			}
			json(res, 404, { error: "not found" });
		})().catch((error) => {
			const message = error.message;
			deps.onError?.(message);
			json(res, 500, { error: message });
		});
	} };
}
//#endregion
//#region src/ws.ts
function createCodexWs(deps) {
	const wss = new WebSocketServer({ noServer: true });
	const grace = deps.reconnectGraceMs ?? 3e4;
	wss.on("connection", (ws, req) => {
		attach(ws, req);
	});
	async function attach(ws, req) {
		const url = new URL(req.url ?? "/", "http://dsh.internal");
		const sessionId = url.searchParams.get("sessionId");
		if (sessionId === null || sessionId === "") {
			ws.close(1008, "sessionId is required");
			return;
		}
		let instance;
		try {
			const prepared = await deps.prepare(sessionId, url.searchParams.get("cwd") ?? void 0);
			instance = await deps.registry.open(prepared.spawn, {
				cols: 80,
				rows: 24
			});
		} catch (error) {
			const reason = `codex-spawn-failed:${error.message}`.slice(0, 120);
			deps.onError?.(reason);
			ws.close(1011, reason);
			return;
		}
		deps.registry.cancelClose(instance.id);
		instance.parked = false;
		if (instance.transcript !== "") ws.send(instance.transcript);
		const onData = (data) => {
			if (ws.readyState === ws.OPEN && ws.bufferedAmount < 4194304) ws.send(data);
		};
		const onExit = ({ exitCode }) => {
			onData(`\r\n[codex exited with code ${String(exitCode)}]\r\n`);
		};
		const dataSub = instance.pty.onData(onData);
		const exitSub = instance.pty.onExit(onExit);
		ws.on("message", (raw) => {
			const text = raw.toString();
			if (!text.startsWith("{")) {
				instance.pty.write(text);
				return;
			}
			try {
				const frame = JSON.parse(text);
				if (frame.type === "resize" && typeof frame.cols === "number" && typeof frame.rows === "number") {
					try {
						instance.pty.resize(Math.max(2, Math.floor(frame.cols)), Math.max(2, Math.floor(frame.rows)));
					} catch {}
					return;
				}
				if (frame.type === "repaint") {
					try {
						const { cols, rows } = instance.pty;
						instance.pty.resize(Math.max(2, cols - 1), rows);
						setTimeout(() => {
							try {
								instance.pty.resize(cols, rows);
							} catch {}
						}, 60);
					} catch {}
					return;
				}
				if (frame.type === "park" || frame.type === "close") {
					deps.registry.park(instance.id);
					return;
				}
			} catch {
				instance.pty.write(text);
			}
		});
		ws.on("close", () => {
			dataSub.dispose();
			exitSub.dispose();
			if (!instance.parked) deps.registry.scheduleClose(instance.id, grace);
		});
	}
	return {
		handleUpgrade(req, socket, head) {
			if (!deps.isTrusted(req)) {
				socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
				socket.destroy();
				return;
			}
			wss.handleUpgrade(req, socket, head, (ws) => {
				wss.emit("connection", ws, req);
			});
		},
		close() {
			wss.close();
		}
	};
}
//#endregion
//#region src/index.ts
/**
* dsh-codex-sidebar — host half.
*
* Owns: the codex instance registry (the only codex-process owner in this
* host), the `/codex-sidebar/ws` terminal transport, the loopback bridge the
* MCP shim talks to, and the `codex_*` DSH tools.
*
* Everything DSH-specific is reached through `ctx.get(...)` structural mirrors
* (src/host-types.ts) so the plugin never imports a second copy of the DSH
* runtime packages, and a host that lacks an optional service degrades with a
* readable error instead of failing at import time.
*/
const name = "dsh-codex-sidebar";
const inject = ["webServer", "tools"];
/** The directory holding this plugin's built files (lib/). */
function pluginRoot() {
	return dirname(fileURLToPath(import.meta.url));
}
/** Resolve the codex executable from the host's own PATH. */
function resolveCodex(pathValue = process.env.PATH ?? "") {
	for (const dir of pathValue.split(delimiter)) {
		if (dir === "") continue;
		const candidate = join(dir, process.platform === "win32" ? "codex.cmd" : "codex");
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	throw new Error("codex executable not found on PATH (install codex-cli or put it on the DSH host PATH)");
}
/**
* The user's own `developer_instructions`, when their ~/.codex/config.toml sets
* one. We APPEND it after our identity text rather than letting `-c` clobber
* it. A minimal top-level TOML scan is enough here: the value is a single-line
* string, and anything more exotic is left alone (the key then simply is not
* appended, and our injection still stands).
*/
function userDeveloperInstructions(configPath = join(homedir(), ".codex", "config.toml")) {
	let text;
	try {
		text = readFileSync(configPath, "utf8");
	} catch {
		return;
	}
	let table = null;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		if (trimmed.startsWith("[")) {
			table = trimmed;
			continue;
		}
		if (table !== null) continue;
		const match = /^developer_instructions\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*$/.exec(trimmed);
		if (match === null) continue;
		const raw = match[1] ?? "";
		const value = raw.startsWith("'") ? raw.slice(1, -1) : JSON.parse(raw);
		return value === "" ? void 0 : value;
	}
}
/** Session cwd: live header first, then the client hint, then the persisted header. */
async function sessionCwdOf(host, sessionId, hint) {
	const live = host.get("sessions")?.get(sessionId)?.header?.cwd;
	if (typeof live === "string" && live !== "") return live;
	if (hint !== void 0 && hint !== "") return hint;
	const persistence = host.get("sessionPersistence");
	if (persistence !== void 0) {
		const handle = await persistence.open(sessionId, "read");
		try {
			const cwd = handle.header.cwd;
			if (typeof cwd === "string" && cwd !== "") return cwd;
		} finally {
			await handle.close();
		}
	}
	return process.cwd();
}
function apply(ctx) {
	const host = ctx;
	const log = host.logger?.("dsh-codex-sidebar");
	const registry = new CodexRegistry({
		...productionOptions(),
		onData: (instance) => {
			if (instance.threadId !== void 0) return;
			const discovered = threadIdFromTranscript(instance.transcript);
			if (discovered !== void 0) instance.threadId = discovered;
		}
	});
	const loopback = createLoopback({
		registry,
		deps: {
			bridge: host.get("dshBridge"),
			agents: host.get("agents"),
			log
		}
	});
	const codexPath = resolveCodex();
	const shimPath = join(pluginRoot(), "codex-mcp.js");
	const trustedHosts = () => host.get("webRuntime")?.trustedHosts ?? [];
	/** Resolve (or mint) the spawn input for a session; shared by WS and API. */
	const prepare = async (sessionId, hint) => {
		await loopback.ready;
		const cwd = await sessionCwdOf(host, sessionId, hint);
		const instanceId = randomUUID();
		const instructions = userDeveloperInstructions();
		return {
			spawn: {
				shimPath,
				nodePath: process.execPath,
				sessionId,
				instanceId,
				cwd,
				loopbackUrl: loopback.url(),
				loopbackToken: loopback.tokenFor(instanceId),
				codexPath,
				...instructions === void 0 ? {} : { userDeveloperInstructions: instructions }
			},
			cwd
		};
	};
	const ws = createCodexWs({
		registry,
		isTrusted: (req) => isTrustedRequest(req, trustedHosts()),
		onError: (message) => {
			log?.error(message);
		},
		prepare
	});
	const http = createCodexHttp({
		registry,
		isTrusted: (req) => isTrustedRequest(req, trustedHosts()),
		onError: (message) => {
			log?.error(message);
		},
		prepare: async (sessionId) => await prepare(sessionId)
	});
	ctx.effect(() => host.webServer.register({
		kind: "prefix",
		path: "/codex-sidebar/api",
		handler: http.handle
	}));
	ctx.effect(() => host.webServer.registerUpgrade({
		path: "/codex-sidebar/ws",
		handler: ws.handleUpgrade
	}));
	for (const definition of createCodexTools({
		registry,
		codexPath,
		prepare: async (sessionId) => await prepare(sessionId)
	})) ctx.effect(() => host.tools.register(definition));
	ctx.effect(() => () => {
		ws.close();
		registry.disposeAll();
		loopback.close();
	});
	log?.info(`ready (codex: ${codexPath}, bridge: ${loopback.url() || "pending"})`);
}
//#endregion
export { apply, inject, name, resolveCodex, sessionCwdOf, userDeveloperInstructions };
