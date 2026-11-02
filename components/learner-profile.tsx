"use client";

/**
 * Auto-calibration UI (fork, Sprint phase 4): the in-session proposal card
 * (approve with one tap) and the settings list (switch any rule off).
 */
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { AdaptationView } from "@/src/core";

function useProfile(refreshKey: unknown) {
	const [items, setItems] = useState<AdaptationView[] | null>(null);
	useEffect(() => {
		let live = true;
		fetch("/api/profile")
			.then((r) => (r.ok ? r.json() : null))
			.then((j: { adaptations?: AdaptationView[] } | null) => { if (live && j?.adaptations) setItems(j.adaptations); })
			.catch(() => {});
		return () => { live = false; };
	}, [refreshKey]);
	const decide = useCallback(async (category: string, action: "approve" | "reject" | "on" | "off") => {
		const r = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category, action }) }).catch(() => null);
		const j = r?.ok ? ((await r.json()) as { adaptations?: AdaptationView[] }) : null;
		if (j?.adaptations) setItems(j.adaptations);
	}, []);
	return { items, decide };
}

/** Shown in the transcript between turns when a pattern crossed the bar. */
export function ProfileProposal({ busy }: { busy: boolean }) {
	const { items, decide } = useProfile(busy);
	const [open, setOpen] = useState(false);
	if (busy || !items) return null;
	const p = items.find((a) => a.status === "pending");
	if (!p) return null;
	return (
		<div className="lh-card-enter rounded-xl border border-violet-500/30 bg-violet-500/[0.05] p-4 text-sm" data-testid="profile-proposal">
			<div className="mb-1 font-ui text-[10px] font-medium uppercase tracking-widest text-violet-300/80">
				Auto-calibration · {p.hits}× across {p.sessions} sessions
			</div>
			<p className="font-medium">{p.noticed}</p>
			<p className="mt-1 text-muted-foreground">
				Adapt from now on: <span className="text-foreground">{p.title}</span> — {p.rule.replace(/\bhim\b/g, "you").replace(/\bHe\b/g, "You").replace(/\bhe\b/g, "you").replace(/\bhis\b/g, "your")}
			</p>
			<button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline">
				{open ? "Hide evidence" : "Show evidence"}
			</button>
			{open && (
				<ul className="mt-2 space-y-1 text-xs text-muted-foreground">
					{p.evidence.map((e, i) => (
						<li key={i}>
							<span className="text-foreground/80">{e.chatTitle}:</span> “{e.note}”
						</li>
					))}
				</ul>
			)}
			<div className="mt-3 flex gap-2">
				<button type="button" onClick={() => void decide(p.category, "approve")} className="rounded-md bg-violet-500/25 px-3 py-1 text-xs font-medium text-violet-100 hover:bg-violet-500/35" data-testid="profile-approve">
					Apply
				</button>
				<button type="button" onClick={() => void decide(p.category, "reject")} className="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-muted/50" data-testid="profile-reject">
					Not for me
				</button>
			</div>
		</div>
	);
}

/** Settings → Agent: every adaptation, its evidence count, and its switch. */
export function ProfileSettings() {
	const { items, decide } = useProfile(0);
	if (!items) return null;
	return (
		<div className="space-y-2" data-testid="profile-settings">
			{items.map((a) => {
				const on = a.status === "on";
				return (
					<div key={a.category} className="flex items-center justify-between gap-4 py-1">
						<div className="min-w-0">
							<div className="text-sm">{a.title}</div>
							<div className="font-ui text-xs text-muted-foreground">
								{a.status === "watching"
									? `Watching · ${a.hits}/3 signs in ${a.sessions}/2 sessions`
									: a.status === "pending"
										? `Proposed · ${a.hits} signs in ${a.sessions} sessions`
										: a.status === "rejected"
											? "You said not for me"
											: `${on ? "On" : "Off"} · ${a.hits} signs in ${a.sessions} sessions`}
							</div>
						</div>
						{a.status === "watching" ? null : (
							<button
								type="button"
								role="switch"
								aria-checked={on}
								aria-label={a.title}
								onClick={() => void decide(a.category, on ? "off" : "on")}
								className={cn("h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors", on ? "bg-violet-500/70" : "bg-muted")}
							>
								<span className={cn("block size-5 rounded-full bg-background shadow transition-transform", on && "translate-x-5")} />
							</button>
						)}
					</div>
				);
			})}
		</div>
	);
}
