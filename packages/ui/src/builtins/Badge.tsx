import { Text } from "react-native";
import { type BadgeProps } from "@mdxserve/shared/builtins/badge";
import { Inline } from "../primitives/Inline";

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

/** The pill's fill and border, and the colour of its label. */
const TONE_STYLES: Record<Tone, Record<Variant, { box: string; label: string }>> = {
	neutral: {
		soft: { box: "bg-surface-sunken border-border-default", label: "text-text-muted" },
		solid: { box: "bg-n-600 border-transparent", label: "text-n-0" },
		outline: { box: "bg-transparent border-border-default", label: "text-text-muted" },
	},
	teal: {
		soft: { box: "bg-surface-accent-soft border-teal-200", label: "text-text-accent" },
		solid: { box: "bg-teal-550 border-transparent", label: "text-n-0" },
		outline: { box: "bg-transparent border-teal-300", label: "text-text-accent" },
	},
	info: {
		soft: { box: "bg-status-info-bg border-transparent", label: "text-status-info-fg" },
		solid: { box: "bg-status-info-fg border-transparent", label: "text-text-inverse" },
		outline: { box: "bg-transparent border-status-info-fg", label: "text-status-info-fg" },
	},
	ok: {
		soft: { box: "bg-status-ok-bg border-transparent", label: "text-status-ok-fg" },
		solid: { box: "bg-status-ok-fg border-transparent", label: "text-text-inverse" },
		outline: { box: "bg-transparent border-status-ok-fg", label: "text-status-ok-fg" },
	},
	warn: {
		soft: { box: "bg-status-warn-bg border-transparent", label: "text-status-warn-fg" },
		solid: { box: "bg-status-warn-fg border-transparent", label: "text-text-inverse" },
		outline: { box: "bg-transparent border-status-warn-fg", label: "text-status-warn-fg" },
	},
	danger: {
		soft: { box: "bg-status-danger-bg border-transparent", label: "text-status-danger-fg" },
		solid: { box: "bg-status-danger-fg border-transparent", label: "text-text-inverse" },
		outline: { box: "bg-transparent border-status-danger-fg", label: "text-status-danger-fg" },
	},
	note: {
		soft: { box: "bg-status-note-bg border-transparent", label: "text-status-note-fg" },
		solid: { box: "bg-status-note-fg border-transparent", label: "text-text-inverse" },
		outline: { box: "bg-transparent border-status-note-fg", label: "text-status-note-fg" },
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
	const style = TONE_STYLES[resolved][variant];
	return (
		<Inline
			className={`not-prose inline-flex flex-row items-center gap-1.5 h-5 rounded-sm border px-1.5 ${style.box}`}
		>
			{dot ? (
				<Inline
					className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_STYLES[resolved]}`}
					aria-hidden={true}
				/>
			) : null}
			<Text
				className={`font-sans leading-normal text-[length:var(--size-xs)] font-semibold ${style.label}`}
			>
				{children}
			</Text>
		</Inline>
	);
}
