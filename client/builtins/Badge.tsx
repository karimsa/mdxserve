import type { ReactNode } from "react";
import { z } from "zod";

export const badgeProps = z.object({
	tone: z
		.enum(["neutral", "teal", "info", "ok", "warn", "danger", "note"])
		.default("neutral")
		.describe("Tone of the badge."),
	color: z
		.enum(["gray", "sky", "green", "amber", "red", "violet"])
		.optional()
		.describe(
			"Deprecated alias for `tone` (gray→neutral, sky→info, green→ok, amber→warn, red→danger, violet→note). Prefer `tone`.",
		),
	variant: z.enum(["soft", "solid", "outline"]).default("soft").describe("Fill style."),
	dot: z.boolean().default(false).describe("Show a leading status dot."),
	children: z.custom<ReactNode>().describe("Badge label."),
});

export type BadgeProps = z.infer<typeof badgeProps>;

type Tone = NonNullable<BadgeProps["tone"]>;
type Variant = NonNullable<BadgeProps["variant"]>;

const COLOR_TO_TONE: Record<NonNullable<BadgeProps["color"]>, Tone> = {
	gray: "neutral",
	sky: "info",
	green: "ok",
	amber: "warn",
	red: "danger",
	violet: "note",
};

function resolveTone({ tone, color }: Pick<BadgeProps, "tone" | "color">): Tone {
	if (tone) return tone;
	if (color) return COLOR_TO_TONE[color];
	return "neutral";
}

const TONE_STYLES: Record<Tone, Record<Variant, string>> = {
	neutral: {
		soft: "bg-surface-sunken text-text-muted border-border-default",
		solid: "bg-n-600 text-n-0 border-transparent",
		outline: "bg-transparent text-text-muted border-border-default",
	},
	teal: {
		soft: "bg-surface-accent-soft text-text-accent border-teal-200",
		solid: "bg-teal-500 text-n-0 border-transparent",
		outline: "bg-transparent text-text-accent border-teal-300",
	},
	info: {
		soft: "bg-status-info-bg text-status-info-fg border-transparent",
		solid: "bg-status-info-fg text-text-inverse border-transparent",
		outline: "bg-transparent text-status-info-fg border-current",
	},
	ok: {
		soft: "bg-status-ok-bg text-status-ok-fg border-transparent",
		solid: "bg-status-ok-fg text-text-inverse border-transparent",
		outline: "bg-transparent text-status-ok-fg border-current",
	},
	warn: {
		soft: "bg-status-warn-bg text-status-warn-fg border-transparent",
		solid: "bg-status-warn-fg text-text-inverse border-transparent",
		outline: "bg-transparent text-status-warn-fg border-current",
	},
	danger: {
		soft: "bg-status-danger-bg text-status-danger-fg border-transparent",
		solid: "bg-status-danger-fg text-text-inverse border-transparent",
		outline: "bg-transparent text-status-danger-fg border-current",
	},
	note: {
		soft: "bg-status-note-bg text-status-note-fg border-transparent",
		solid: "bg-status-note-fg text-text-inverse border-transparent",
		outline: "bg-transparent text-status-note-fg border-current",
	},
};

const DOT_STYLES: Record<Tone, string> = {
	neutral: "bg-n-500",
	teal: "bg-teal-500",
	info: "bg-status-info-fg",
	ok: "bg-status-ok-fg",
	warn: "bg-status-warn-fg",
	danger: "bg-status-danger-fg",
	note: "bg-status-note-fg",
};

export default function Badge({
	tone,
	color,
	variant = "soft",
	dot = false,
	children,
}: BadgeProps) {
	const resolved = resolveTone({ tone, color });
	return (
		<span
			className={`not-prose inline-flex items-center gap-1.5 h-5 rounded-sm border px-1.5 font-sans leading-normal text-[length:var(--size-xs)] font-semibold ${TONE_STYLES[resolved][variant]}`}
		>
			{dot ? (
				<span
					className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_STYLES[resolved]}`}
					aria-hidden="true"
				/>
			) : null}
			{children}
		</span>
	);
}
