"use client";

/**
 * The Sprint game layer (fork, 2026-10-31): a thin HUD (level, XP bar,
 * 30-minute sprint clock with its 5/20/5 phases), XP pops, boss and
 * level-up effects, and the FOCUS CARD that fills the model's thinking
 * time with recall from this very session. Owner rules: XP only from
 * understanding; effects short and never blocking; a zen toggle hides it
 * all. XP itself is derived (src/core/xp.ts) — this file only shows it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { levelFor, recallCards, sessionXpEvents, sumXp, type LhViewMessage, type XpEvent } from "@/src/core";

const ZEN_KEY = "lh-zen";
const bonusKey = (chatId: string) => `lh-recall-xp:${chatId}`;
const SPRINT_MS = 30 * 60_000;

function readLocal(key: string): string | null {
	try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string) {
	try { window.localStorage.setItem(key, value); } catch { /* private mode: the page still works */ }
}

/** Recall-card XP lives per viewer (self-graded, small) — the one piece
 *  not derivable from the record. */
export function useRecallBonus(chatId: string): [number, (n: number) => void] {
	const [bonus, setBonus] = useState(0);
	useEffect(() => { setBonus(Number(readLocal(bonusKey(chatId)) ?? 0) || 0); }, [chatId]);
	const add = (n: number) => setBonus((b) => { const next = b + n; writeLocal(bonusKey(chatId), String(next)); return next; });
	return [bonus, add];
}

type Pop = { key: string; amount: number; label: string };
type Banner = { key: string; title: string; sub: string; kind: "boss" | "level" };

export function GameHud({
	chatId,
	messages,
	busy,
	sessionStart,
	bonus,
}: {
	chatId: string;
	messages: LhViewMessage[];
	busy: boolean;
	sessionStart: number | null;
	bonus: number;
}) {
	const [zen, setZen] = useState(false);
	useEffect(() => { setZen(readLocal(ZEN_KEY) === "1"); }, []);
	const toggleZen = () => setZen((z) => { writeLocal(ZEN_KEY, z ? "0" : "1"); return !z; });

	// Lifetime XP from every OTHER session; refreshed when a turn settles.
	const [lifetime, setLifetime] = useState(0);
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
		if (busy) return;
		let live = true;
		fetch(`/api/xp?exclude=${encodeURIComponent(chatId)}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((j: { total?: number } | null) => { if (live && typeof j?.total === "number") setLifetime(j.total); })
			.catch(() => {})
			.finally(() => { if (live) setLoaded(true); });
		return () => { live = false; };
	}, [chatId, busy]);

	const events = useMemo(() => sessionXpEvents(messages), [messages]);
	const sessionXp = sumXp(events) + bonus;
	const total = lifetime + sessionXp;
	const info = levelFor(total);

	// New events → pops, shake, boss/level effects. The first render only
	// marks what's already there as seen.
	const seen = useRef<Set<string> | null>(null);
	const lastLevel = useRef<number | null>(null);
	const lastBonus = useRef(bonus);
	const [pops, setPops] = useState<Pop[]>([]);
	const [shake, setShake] = useState(0);
	const [banner, setBanner] = useState<Banner | null>(null);
	const [burst, setBurst] = useState(0);
	useEffect(() => {
		if (seen.current === null) {
			seen.current = new Set(events.map((e) => e.id));
			return;
		}
		const fresh: XpEvent[] = events.filter((e) => !seen.current!.has(e.id));
		if (bonus > lastBonus.current) fresh.push({ id: `bonus:${bonus}`, kind: "recall", amount: bonus - lastBonus.current, label: "Recalled" });
		lastBonus.current = bonus;
		if (fresh.length === 0) return;
		fresh.forEach((e) => seen.current!.add(e.id));
		setPops((p) => [...p, ...fresh.map((e) => ({ key: `${e.id}:${Date.now()}`, amount: e.amount, label: e.label }))]);
		setShake((s) => s + 1);
		const boss = fresh.find((e) => e.kind === "boss");
		if (boss && !zen) {
			setBanner({ key: boss.id, title: "BOSS DEFEATED", sub: `+${boss.amount} XP · the idea is yours`, kind: "boss" });
			setBurst((b) => b + 1);
			document.documentElement.classList.remove("lh-screen-shake");
			void document.documentElement.offsetWidth;
			document.documentElement.classList.add("lh-screen-shake");
		}
	}, [events, bonus, zen]);
	useEffect(() => {
		if (!loaded) return; // the lifetime fetch would read as a fake level-up
		if (lastLevel.current !== null && info.level > lastLevel.current && !zen) {
			setBanner({ key: `lvl:${info.level}`, title: `LEVEL ${info.level}`, sub: info.title, kind: "level" });
			setBurst((b) => b + 1);
		}
		lastLevel.current = info.level;
	}, [info.level, info.title, zen, loaded]);
	useEffect(() => {
		if (pops.length === 0) return;
		const t = setTimeout(() => setPops((p) => p.slice(1)), 1400);
		return () => clearTimeout(t);
	}, [pops]);
	useEffect(() => {
		if (!banner) return;
		const t = setTimeout(() => setBanner(null), 2200);
		return () => clearTimeout(t);
	}, [banner]);

	// The sprint clock.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, []);
	const elapsed = sessionStart ? Math.max(0, now - sessionStart) : 0;
	const minute = elapsed / 60_000;
	const phase = minute < 5 ? "CLICK" : minute < 25 ? "BUILD" : minute < 30 ? "WRAP-UP" : "OVERTIME";
	const mm = Math.floor(elapsed / 60_000);
	const ss = Math.floor((elapsed % 60_000) / 1000);

	if (zen) {
		return (
			<div className="flex justify-end px-4 pt-1">
				<button type="button" onClick={toggleZen} className="font-ui text-[10px] uppercase tracking-widest text-muted-foreground/60 hover:text-foreground" data-testid="zen-off">
					zen · show game
				</button>
			</div>
		);
	}

	return (
		<>
			<div className="relative flex items-center gap-3 border-b border-border/40 px-4 py-1.5 font-ui text-xs" data-testid="game-hud">
				<div className="flex shrink-0 items-center gap-2">
					<span className="grid size-6 place-items-center rounded-md bg-amber-500/15 font-bold text-amber-400" title={`Level ${info.level}`}>
						{info.level}
					</span>
					<span className="hidden font-medium uppercase tracking-wide text-muted-foreground sm:inline">{info.title}</span>
				</div>
				<div key={shake} className={cn("relative h-2 min-w-16 flex-1 overflow-visible rounded-full bg-muted/60", shake > 0 && "lh-xp-shake")}>
					<div
						className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-300 transition-[width] duration-700 ease-out"
						style={{ width: `${Math.min(100, (info.into / info.needed) * 100)}%` }}
					/>
					{pops.map((p) => (
						<span key={p.key} className="lh-xp-pop pointer-events-none absolute -top-1 right-0 whitespace-nowrap font-bold text-amber-300">
							+{p.amount} <span className="font-normal text-amber-200/80">{p.label}</span>
						</span>
					))}
				</div>
				<span className="shrink-0 tabular-nums text-muted-foreground" title="XP this level">
					{info.into}/{info.needed} · <span className="text-amber-300">+{sessionXp}</span> today
				</span>
				<div className="flex w-36 shrink-0 flex-col gap-0.5" title="5 min click · 20 min build · 5 min wrap-up">
					<div className="flex items-center justify-between">
						<span className={cn("font-medium tracking-wide", phase === "OVERTIME" ? "text-red-400" : phase === "WRAP-UP" ? "text-amber-300" : "text-muted-foreground")}>{phase}</span>
						<span className="tabular-nums text-muted-foreground">{mm}:{String(ss).padStart(2, "0")}</span>
					</div>
					<div className="relative flex h-1.5 gap-0.5 overflow-hidden rounded-full">
						<div className="h-full basis-[16.6%] bg-sky-500/25" />
						<div className="h-full basis-[66.8%] bg-violet-500/25" />
						<div className="h-full basis-[16.6%] bg-amber-500/25" />
						<div className="absolute inset-y-0 left-0 bg-foreground/60" style={{ width: `${Math.min(100, (elapsed / SPRINT_MS) * 100)}%` }} />
					</div>
				</div>
				<button type="button" onClick={toggleZen} className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground/60 hover:text-foreground" data-testid="zen-on" title="Hide the game">
					zen
				</button>
			</div>
			{banner && (
				<div key={banner.key} className="pointer-events-none fixed inset-0 z-50 grid place-items-center" aria-live="polite">
					<div className={cn("lh-banner-pop rounded-2xl border px-10 py-6 text-center shadow-2xl backdrop-blur-md", banner.kind === "boss" ? "border-amber-400/60 bg-amber-950/70" : "border-violet-400/60 bg-violet-950/70")}>
						<div className={cn("font-ui text-3xl font-black tracking-[0.2em]", banner.kind === "boss" ? "text-amber-300" : "text-violet-200")}>{banner.title}</div>
						<div className="mt-1 text-sm text-foreground/80">{banner.sub}</div>
					</div>
				</div>
			)}
			{burst > 0 && <Particles key={burst} />}
		</>
	);
}

function Particles() {
	const [gone, setGone] = useState(false);
	useEffect(() => { const t = setTimeout(() => setGone(true), 1500); return () => clearTimeout(t); }, []);
	const bits = useMemo(
		() => Array.from({ length: 36 }, (_, i) => {
			const angle = (i / 36) * Math.PI * 2 + Math.random() * 0.3;
			const dist = 160 + Math.random() * 220;
			return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, hue: 35 + Math.random() * 30, delay: Math.random() * 120 };
		}),
		[],
	);
	if (gone) return null;
	return (
		<div className="pointer-events-none fixed inset-0 z-40 grid place-items-center" aria-hidden="true">
			{bits.map((b, i) => (
				<span
					key={i}
					className="lh-particle absolute size-2 rounded-full"
					style={{ background: `hsl(${b.hue} 95% 60%)`, ["--dx" as string]: `${b.dx}px`, ["--dy" as string]: `${b.dy}px`, animationDelay: `${b.delay}ms` }}
				/>
			))}
		</div>
	);
}

/** Original one-liners for the wait — focus and learning, nothing that
 *  pulls attention off the topic. */
const LINES = [
	"Stay here. The next step is coming, and you're the one who has to catch it.",
	"Confusion is the feeling of your brain rewiring. Lean in.",
	"Nobody gets smart by switching tabs.",
	"Say the idea in your head right now, in ten words. Can you?",
	"Every expert was once someone who refused to stop at 'I kind of get it'.",
	"Thirty focused minutes beat three distracted hours.",
	"If you can't explain it simply, you're one step from understanding it. Take the step.",
	"The pitch boss is waiting at minute 25. Be ready.",
	"Volume of reps beats talent. This is a rep.",
	"Guess before you're told. Wrong guesses teach more than right answers you didn't earn.",
	"Your attention is the whole game. Keep it on the board.",
	"Hard now means easy forever.",
	"Predict the next step. Then see if you were right.",
	"Clarity is a skill. You're training it right now.",
	"Simple isn't dumb. Simple is what's left when you truly get it.",
];

export function FocusCard({ messages, busy, onRecall }: { messages: LhViewMessage[]; busy: boolean; onRecall: (xp: number) => void }) {
	const cards = useMemo(() => recallCards(messages), [messages]);
	const [visible, setVisible] = useState(false);
	const [tick, setTick] = useState(() => Math.floor(Math.random() * 1000));
	const [revealed, setRevealed] = useState(false);
	const [graded, setGraded] = useState<null | "knew" | "missed">(null);

	// Appear only for a real wait (no flash on fast turns).
	useEffect(() => {
		if (!busy) { setVisible(false); return; }
		const t = setTimeout(() => { setVisible(true); setRevealed(false); setGraded(null); setTick((n) => n + 1); }, 700);
		return () => clearTimeout(t);
	}, [busy]);
	// Rotate while waiting — but never mid-card: a revealed, ungraded card holds.
	useEffect(() => {
		if (!visible || (revealed && !graded)) return;
		const t = setTimeout(() => { setTick((n) => n + 1); setRevealed(false); setGraded(null); }, graded ? 2500 : 9000);
		return () => clearTimeout(t);
	}, [visible, revealed, graded, tick]);

	if (!visible) return null;
	const useCard = cards.length > 0 && tick % 3 !== 2;
	const card = useCard ? cards[tick % cards.length]! : null;

	return (
		<div className="lh-card-enter rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4" data-testid="focus-card">
			<div className="mb-2 flex items-center justify-between font-ui text-[10px] font-medium uppercase tracking-widest text-amber-300/80">
				<span>{card ? "While it thinks · quick recall" : "While it thinks"}</span>
				{card && <span>+3 XP</span>}
			</div>
			{card ? (
				<>
					<p className="text-sm text-foreground/90">{card.question}</p>
					{!revealed ? (
						<button type="button" onClick={() => setRevealed(true)} className="mt-3 rounded-md border border-border/60 px-3 py-1 text-xs hover:bg-muted/50" data-testid="focus-reveal">
							Answer it in your head, then reveal
						</button>
					) : (
						<div className="mt-3 space-y-2">
							<p className="rounded-md bg-muted/40 px-3 py-2 text-sm">{card.answer}</p>
							{graded === null ? (
								<div className="flex gap-2">
									<button type="button" onClick={() => { setGraded("knew"); onRecall(3); }} className="rounded-md bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/30" data-testid="focus-knew">
										I knew it
									</button>
									<button type="button" onClick={() => setGraded("missed")} className="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-muted/50">
										Missed it
									</button>
								</div>
							) : (
								<p className="text-xs text-muted-foreground">{graded === "knew" ? "Locked." : "Good — now you'll remember it."}</p>
							)}
						</div>
					)}
				</>
			) : (
				<p className="text-base font-medium leading-snug text-foreground/90">{LINES[tick % LINES.length]}</p>
			)}
		</div>
	);
}
