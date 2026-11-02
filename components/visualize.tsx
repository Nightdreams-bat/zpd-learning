"use client";

import { useEffect, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckIcon, SparklesIcon } from "lucide-react";

/**
 * VISUALIZE ON DEMAND (owner, 2026-10-28): visuals are opt-in and SCOPED —
 * the learner points at what they don't get, and only that goes to the
 * teacher. Three entry points:
 *  - selection: highlight any passage of teaching text → floating pill
 *  - step:      hover a teaching passage → quiet button at its corner
 *  - sublesson: a card at the end of a finished plan node
 * Each sends one `[visualize]` message (steers mid-turn) carrying the scope,
 * the plan node, and the exact passage; the teacher prompt (50-demos.md)
 * turns it into a demo brief. Pure helpers are exported for tests.
 */

export type VisualizeScope = "selection" | "step" | "sublesson";

export interface VisualizeTarget {
	scope: VisualizeScope;
	passage: string;
	concept?: { title: string; summary?: string };
}

export const VISUALIZE_TAG = "[visualize]";
const SCOPE_LABEL: Record<VisualizeScope, string> = {
	selection: "selected passage",
	step: "this step",
	sublesson: "whole sub-lesson",
};
/** Caps the passage so a request never ships a whole lesson. */
export const MAX_VISUALIZE_PASSAGE = 1500;

export function buildVisualizeRequest(t: VisualizeTarget): string {
	let passage = t.passage.trim();
	if (passage.length > MAX_VISUALIZE_PASSAGE) passage = `${passage.slice(0, MAX_VISUALIZE_PASSAGE).trimEnd()} …`;
	const lines = [`${VISUALIZE_TAG} ${SCOPE_LABEL[t.scope]}`];
	if (t.concept) lines.push(`Concept: ${t.concept.title}${t.concept.summary ? ` — ${t.concept.summary}` : ""}`);
	if (passage) lines.push("Passage:", ...passage.split("\n").map((l) => `> ${l}`));
	lines.push("Animate exactly this part.");
	return lines.join("\n");
}

export interface ParsedVisualizeRequest {
	scope: string;
	concept?: string;
	passage: string;
}

export function parseVisualizeRequest(text: string): ParsedVisualizeRequest | null {
	if (!text.startsWith(VISUALIZE_TAG)) return null;
	const lines = text.split("\n");
	const scope = lines[0]!.slice(VISUALIZE_TAG.length).trim();
	const concept = lines.find((l) => l.startsWith("Concept: "))?.slice("Concept: ".length);
	const passage = lines
		.filter((l) => l.startsWith("> ") || l === ">")
		.map((l) => l.slice(2))
		.join("\n");
	return { scope, concept, passage };
}

// ─── which plan node each teaching passage belongs to ───────────────────────

interface IndexPart {
	type: string;
	text?: string;
	input?: unknown;
}

function nodeIdOf(part: IndexPart): string | null {
	if (part.type !== "tool-quiz" && part.type !== "tool-explain") return null;
	const id = (part.input as { nodeId?: unknown } | undefined)?.nodeId;
	return typeof id === "string" && id ? id : null;
}

export interface VisualizeIndex {
	/** "mi:pi" of a text part → the plan node it teaches. */
	nodeOfText: Map<string, string>;
	/** message index → nodes whose sub-lesson ends in that message. */
	sublessonEnds: Map<number, string[]>;
}

/** Teaching text belongs to the node of the next check in its message
 *  (the explanation precedes its check), else the last node seen. A
 *  sub-lesson ends where the checks move on to a different node. */
export function buildVisualizeIndex(messages: readonly { role: string; parts: readonly IndexPart[] }[]): VisualizeIndex {
	const nodeOfText = new Map<string, string>();
	const tagged: { mi: number; node: string }[] = [];
	let last: string | null = null;
	messages.forEach((m, mi) => {
		if (m.role !== "assistant") return;
		const ids = m.parts.map(nodeIdOf);
		m.parts.forEach((part, pi) => {
			const own = ids[pi];
			if (own) {
				tagged.push({ mi, node: own });
				last = own;
				return;
			}
			if (part.type !== "text") return;
			const next = ids.slice(pi + 1).find((id) => id);
			const node = next ?? last;
			if (node) nodeOfText.set(`${mi}:${pi}`, node);
		});
	});
	const endAt = new Map<string, number>();
	for (let k = 0; k < tagged.length - 1; k++) {
		if (tagged[k]!.node !== tagged[k + 1]!.node) endAt.set(tagged[k]!.node, tagged[k]!.mi);
	}
	const sublessonEnds = new Map<number, string[]>();
	for (const [node, mi] of endAt) sublessonEnds.set(mi, [...(sublessonEnds.get(mi) ?? []), node]);
	return { nodeOfText, sublessonEnds };
}

// ─── UI ─────────────────────────────────────────────────────────────────────

const SPRING = { type: "spring" as const, stiffness: 520, damping: 32, mass: 0.7 };

/** The quiet per-step button: appears on hover of its `group/step` passage. */
export function StepVisualizeButton({ onClick }: { onClick: () => void }) {
	const [sent, setSent] = useState(false);
	return (
		<button
			type="button"
			data-testid="visualize-step"
			aria-label="Visualize this step"
			title="Visualize this step"
			onClick={() => {
				setSent(true);
				onClick();
			}}
			disabled={sent}
			className={`absolute -right-9 top-0.5 grid size-7 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm transition-all duration-200 ease-out hover:scale-110 hover:border-sky-400/60 hover:text-sky-500 focus-visible:opacity-100 ${
				sent ? "opacity-100 text-sky-500" : "opacity-0 group-hover/step:opacity-100"
			}`}
		>
			{sent ? <CheckIcon className="size-3.5" /> : <SparklesIcon className="size-3.5" />}
		</button>
	);
}

/** The end-of-sub-lesson card: one animation for the whole node. */
export function SublessonVisualizeCard({
	title,
	summary,
	onClick,
}: {
	title: string;
	summary?: string;
	onClick: () => void;
}) {
	const [sent, setSent] = useState(false);
	return (
		<motion.div
			initial={{ opacity: 0, y: 8, scale: 0.985 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
			data-testid="visualize-sublesson"
			className="group/sub relative my-3 overflow-hidden rounded-2xl border bg-card p-[1px]"
		>
			{/* slow-drifting aurora border: the card's one flourish */}
			<div
				aria-hidden
				className="pointer-events-none absolute -inset-[40%] opacity-60 blur-2xl transition-opacity duration-500 group-hover/sub:opacity-90 motion-safe:animate-[spin_14s_linear_infinite]"
				style={{
					background: "conic-gradient(from 0deg, #58c4dd33, #9a72ac40, #ffe06630, #83c16733, #58c4dd33)",
				}}
			/>
			<div className="relative flex flex-wrap items-center gap-4 rounded-[15px] bg-card px-5 py-4">
				<div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0e0f12] text-[#58c4dd] shadow-[0_0_24px_rgba(88,196,221,.35)]">
					<SparklesIcon className="size-4.5" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="font-ui text-[11px] font-medium uppercase tracking-[.12em] text-muted-foreground">
						Sub-lesson done
					</div>
					<div className="truncate font-title text-lg leading-snug text-foreground">{title}</div>
					{summary ? <div className="line-clamp-2 text-sm text-muted-foreground">{summary}</div> : null}
				</div>
				<motion.button
					type="button"
					whileHover={sent ? undefined : { scale: 1.035 }}
					whileTap={sent ? undefined : { scale: 0.97 }}
					transition={SPRING}
					disabled={sent}
					onClick={() => {
						setSent(true);
						onClick();
					}}
					className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#0e0f12] px-5 font-ui text-sm font-medium text-[#ececec] shadow-[0_0_0_1px_rgba(88,196,221,.35),0_6px_24px_rgba(88,196,221,.25)] transition-shadow hover:shadow-[0_0_0_1px_rgba(88,196,221,.6),0_8px_32px_rgba(88,196,221,.4)] disabled:opacity-70"
				>
					{sent ? <CheckIcon className="size-4 text-[#83c167]" /> : <SparklesIcon className="size-4 text-[#58c4dd]" />}
					{sent ? "Animation on its way" : "Visualize the whole idea"}
				</motion.button>
			</div>
		</motion.div>
	);
}

/** The learner's request, rendered as a compact card instead of raw text. */
export function VisualizeRequestRow({ request }: { request: ParsedVisualizeRequest }) {
	return (
		<div
			data-testid="visualize-request"
			className="my-2 w-full border-l-[calc(3ch-14px)] border-sky-400/40 bg-card py-1.5 pl-[14px] pr-4 font-ui text-xs"
		>
			<div className="flex items-center gap-1.5 font-medium uppercase tracking-wide text-muted-foreground">
				<SparklesIcon className="size-3 text-sky-500" />
				Visualize · {request.scope}
			</div>
			{request.concept ? <div className="mt-0.5 text-foreground">{request.concept}</div> : null}
			{request.passage ? (
				<div className="mt-0.5 line-clamp-2 italic text-muted-foreground">{request.passage}</div>
			) : null}
		</div>
	);
}

/** Highlight-to-visualize: a floating pill over any selection inside
 *  teaching text (elements marked data-lh-teach). */
export function SelectionVisualize({
	scopeRef,
	onRequest,
}: {
	scopeRef: RefObject<HTMLElement | null>;
	onRequest: (passage: string, nodeId: string | null) => void;
}) {
	const [pick, setPick] = useState<{ x: number; y: number; text: string; node: string | null } | null>(null);

	useEffect(() => {
		const read = () => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setPick(null);
			const text = sel.toString().trim();
			if (text.length < 3) return setPick(null);
			const range = sel.getRangeAt(0);
			const anchor =
				range.commonAncestorContainer instanceof Element
					? range.commonAncestorContainer
					: range.commonAncestorContainer.parentElement;
			const teach = anchor?.closest("[data-lh-teach]");
			if (!teach || !scopeRef.current?.contains(teach)) return setPick(null);
			const r = range.getBoundingClientRect();
			setPick({ x: r.left + r.width / 2, y: r.top, text, node: teach.getAttribute("data-lh-node") });
		};
		const onUp = () => setTimeout(read, 0);
		const onChange = () => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) setPick(null);
		};
		const onScroll = () => setPick(null);
		document.addEventListener("mouseup", onUp);
		document.addEventListener("keyup", onUp);
		document.addEventListener("selectionchange", onChange);
		window.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("mouseup", onUp);
			document.removeEventListener("keyup", onUp);
			document.removeEventListener("selectionchange", onChange);
			window.removeEventListener("scroll", onScroll, true);
		};
	}, [scopeRef]);

	return (
		<AnimatePresence>
			{pick ? (
				<motion.button
					key="viz-pill"
					type="button"
					data-testid="visualize-selection"
					initial={{ opacity: 0, y: 6, scale: 0.9 }}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					exit={{ opacity: 0, y: 4, scale: 0.95 }}
					transition={SPRING}
					whileHover={{ scale: 1.05 }}
					whileTap={{ scale: 0.96 }}
					// Keep the selection alive through the click.
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => {
						onRequest(pick.text, pick.node);
						window.getSelection()?.removeAllRanges();
						setPick(null);
					}}
					style={{ position: "fixed", left: pick.x, top: Math.max(8, pick.y - 46), translateX: "-50%" }}
					className="z-50 inline-flex h-9 items-center gap-2 rounded-full bg-[#0e0f12] px-4 font-ui text-sm font-medium text-[#ececec] shadow-[0_0_0_1px_rgba(88,196,221,.45),0_8px_28px_rgba(0,0,0,.35),0_0_24px_rgba(88,196,221,.3)]"
				>
					<SparklesIcon className="size-4 text-[#58c4dd]" />
					Visualize
				</motion.button>
			) : null}
		</AnimatePresence>
	);
}
