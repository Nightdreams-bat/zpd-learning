import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import type { Block } from "./claude-cli-protocol.ts";

/**
 * The `claude -p` process side of the claude-cli provider (2026-10-24):
 * spawning, the warm pool, and the request handshake. No parsing here.
 *
 * WHY A POOL: a CLI process takes ~0.85 s to start, most of a short model
 * call. The system prompt is NOT a launch argument: it travels in the
 * stream-json `initialize` control request (the same one the Agent SDK
 * sends), written together with the user message when a process is
 * claimed. A parked process is therefore generic — keyed only by (model,
 * effort), the two things that ARE launch arguments — and ANY next call
 * can claim it, including the first call of a brand-new chat. Parked
 * processes idle on stdin (~155 MB each), expire with the 5-minute prompt
 * cache they are paired with, and die with the host (stdin EOF).
 *
 * FALLBACK: `CLAUDE_CLI_SYSTEM=file` (or a CLI that rejects `initialize`)
 * passes the prompt as `--system-prompt-file` instead. That binds a process
 * to one prompt, so file mode never parks anything.
 */

const IDLE_TTL_MS = 5 * 60_000;
const IDLE_MAX = 3;
export const INIT_REQUEST_ID = "lh-init";

/** What a process is launched with. The system prompt is deliberately absent. */
export interface Shape {
	model: string;
	/** `--effort` value; undefined = thinking off. */
	effort: string | undefined;
}

export interface Proc {
	child: ChildProcessWithoutNullStreams;
	stderr: string;
	/** Claimed from the pool (true) or spawned for this call (false). */
	warm: boolean;
	/** System prompt rides in `--system-prompt-file` instead of `initialize`. */
	fileMode: boolean;
	promptFile?: string;
}

/** The command that starts the CLI: `claude`, or CLAUDE_CLI_COMMAND (a JSON array, command + leading
 *  args) so tests can stand a scripted fake in its place. */
function command(): string[] {
	const raw = process.env.CLAUDE_CLI_COMMAND;
	if (raw) {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((p) => typeof p === "string")) return parsed as string[];
		} catch {
			/* fall through to the real CLI */
		}
	}
	return ["claude"];
}

/** Is a `claude` executable on PATH? A cheap directory scan, safe per request. */
export function claudeCliInstalled(): boolean {
	if (process.env.CLAUDE_CLI_COMMAND) return true;
	const names = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
	return (process.env.PATH ?? "").split(delimiter).some((d) => d && names.some((n) => existsSync(join(d, n))));
}

/** A neutral cwd so the CLI discovers no project CLAUDE.md or settings. */
function workDir(): string {
	const base = process.env.CLAUDE_CLI_WORKDIR || join(tmpdir(), "learnharness-claude-cli");
	mkdirSync(base, { recursive: true });
	return base;
}

let initRejected = false;

/** Called when a CLI answers `initialize` with an error: from then on, file mode. */
export function markInitializeRejected(): void {
	initRejected = true;
}

function fileModeOn(): boolean {
	return initRejected || process.env.CLAUDE_CLI_SYSTEM === "file";
}

function warmEnabled(): boolean {
	return process.env.CLAUDE_CLI_WARM !== "0" && !fileModeOn();
}

const key = (s: Shape) => `${s.model}|${s.effort ?? "-"}`;

function alive(p: Proc): boolean {
	return p.child.exitCode === null && p.child.signalCode === null && !p.child.killed;
}

function launch(shape: Shape, system: string): Proc {
	const dir = workDir();
	const fileMode = fileModeOn();
	let promptFile: string | undefined;
	if (fileMode) {
		promptFile = join(dir, `system-${randomUUID()}.md`);
		writeFileSync(promptFile, system, "utf8");
	}

	const env = { ...process.env };
	// The point is the subscription: a stray API key would silently bill the API instead.
	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_AUTH_TOKEN;
	// Skips update/telemetry/survey round trips at startup (~0.5 s).
	env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
	if (!shape.effort) env.MAX_THINKING_TOKENS = "0";

	const args = [
		"-p",
		"--model", shape.model,
		"--input-format", "stream-json",
		"--output-format", "stream-json",
		"--verbose",
		"--include-partial-messages",
		"--tools", "",
		"--no-session-persistence",
		"--disable-slash-commands",
		"--strict-mcp-config",
		"--setting-sources", "",
	];
	if (promptFile) args.push("--system-prompt-file", promptFile);
	if (shape.effort) args.push("--effort", shape.effort);

	const [bin, ...lead] = command() as [string, ...string[]];
	const child = spawn(bin, [...lead, ...args], { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
	const proc: Proc = { child, stderr: "", warm: false, fileMode, ...(promptFile ? { promptFile } : {}) };
	child.stderr.on("data", (d: Buffer) => (proc.stderr += d.toString()));
	child.stdin.on("error", () => {});
	// A parked process has no call attached yet; an unhandled 'error' would crash the host.
	child.on("error", () => {});
	child.on("close", () => {
		if (promptFile) rmSync(promptFile, { force: true });
	});
	return proc;
}

const idle = new Map<string, Proc>();

function retire(k: string, proc: Proc): void {
	if (idle.get(k) === proc) idle.delete(k);
	if (alive(proc)) proc.child.kill();
}

/** A process for this shape: a parked one when available, else a fresh spawn.
 *  `system` is only used in file mode (it is baked into the launch). */
export function acquire(shape: Shape, system: string, opts: { cold?: boolean } = {}): Proc {
	const k = key(shape);
	const parked = idle.get(k);
	if (parked) {
		idle.delete(k);
		if (!opts.cold && alive(parked) && !fileModeOn()) {
			parked.warm = true;
			return parked;
		}
		if (alive(parked)) parked.child.kill();
	}
	return launch(shape, system);
}

/** Park a process for this shape unless one is already waiting. Idempotent and cheap. */
export function prewarm(shape: Shape): void {
	if (!warmEnabled() || !claudeCliInstalled()) return;
	const k = key(shape);
	const existing = idle.get(k);
	if (existing && alive(existing)) return;
	while (idle.size >= IDLE_MAX) {
		const [oldKey, oldest] = idle.entries().next().value as [string, Proc];
		retire(oldKey, oldest);
	}
	const proc = launch(shape, "");
	const timer = setTimeout(() => retire(k, proc), IDLE_TTL_MS);
	timer.unref();
	proc.child.once("close", () => {
		clearTimeout(timer);
		if (idle.get(k) === proc) idle.delete(k);
	});
	idle.set(k, proc);
}

/** Hand a claimed process its whole request, then close stdin so it exits after the answer. */
export function send(proc: Proc, system: string, blocks: readonly Block[]): void {
	const lines: string[] = [];
	if (!proc.fileMode) {
		lines.push(
			JSON.stringify({ type: "control_request", request_id: INIT_REQUEST_ID, request: { subtype: "initialize", systemPrompt: [system] } }),
		);
	}
	lines.push(JSON.stringify({ type: "user", message: { role: "user", content: blocks } }));
	proc.child.stdin.end(`${lines.join("\n")}\n`);
}

process.once("exit", () => {
	for (const [k, proc] of [...idle]) retire(k, proc);
});

/** Tests only: drop every parked process and forget a rejected `initialize`. */
export function resetPoolForTests(): void {
	for (const [k, proc] of [...idle]) retire(k, proc);
	initRejected = false;
}
