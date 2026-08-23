import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { fadeRise } from "../motion";
import { Icon } from "../ui/Icon";

export const calloutProps = z.object({
	tone: z
		.enum(["note", "tip", "ok", "warn", "danger"])
		.default("note")
		.describe(
			"Visual intent and icon: note (info), tip (lightbulb), ok (success), warn (caution), or danger (breaking).",
		),
	type: z
		.enum(["info", "warn"])
		.optional()
		.describe("Deprecated alias for `tone` (info→note, warn→warn). Prefer `tone`."),
	title: z
		.string()
		.optional()
		.describe("Optional bold heading shown above the body; defaults to the tone's label."),
	children: z.custom<ReactNode>().describe("Callout body; any MDX/Markdown content."),
});

export type CalloutProps = z.infer<typeof calloutProps>;

type Tone = NonNullable<CalloutProps["tone"]>;

const TONES: Record<Tone, { icon: string; bg: string; fg: string; fgVar: string; label: string }> =
	{
		note: {
			icon: "info",
			bg: "bg-status-info-bg",
			fg: "text-status-info-fg",
			fgVar: "var(--status-info-fg)",
			label: "Note",
		},
		tip: {
			icon: "lightbulb",
			bg: "bg-surface-accent-soft",
			fg: "text-text-accent",
			fgVar: "var(--text-accent)",
			label: "Tip",
		},
		ok: {
			icon: "circle-check",
			bg: "bg-status-ok-bg",
			fg: "text-status-ok-fg",
			fgVar: "var(--status-ok-fg)",
			label: "Works",
		},
		warn: {
			icon: "triangle-alert",
			bg: "bg-status-warn-bg",
			fg: "text-status-warn-fg",
			fgVar: "var(--status-warn-fg)",
			label: "Careful",
		},
		danger: {
			icon: "octagon-alert",
			bg: "bg-status-danger-bg",
			fg: "text-status-danger-fg",
			fgVar: "var(--status-danger-fg)",
			label: "Breaking",
		},
	};

/** `type` is a deprecated alias kept so existing docs written before `tone` keep working. */
function resolveTone({ tone, type }: Pick<CalloutProps, "tone" | "type">): Tone {
	if (tone) return tone;
	if (type === "warn") return "warn";
	if (type === "info") return "note";
	return "note";
}

export default function Callout({ tone, type, title, children }: CalloutProps) {
	const resolved = resolveTone({ tone, type });
	const t = TONES[resolved];

	return (
		<motion.div
			variants={fadeRise}
			initial="initial"
			animate="enter"
			className={`not-prose flex items-start gap-3 rounded-lg p-4 border border-transparent font-sans font-medium leading-normal text-[length:var(--size-md)] ${t.bg}`}
			style={{ borderColor: `color-mix(in oklab, ${t.fgVar} 22%, transparent)` }}
		>
			<Icon name={t.icon} size="md" className={`mt-0.5 shrink-0 ${t.fg}`} />
			<div className="min-w-0 flex-1">
				<p className={`font-bold tracking-[var(--tracking-snug)] ${t.fg}`}>{title || t.label}</p>
				<div className="mt-1 leading-6 text-text-body">{children}</div>
			</div>
		</motion.div>
	);
}
