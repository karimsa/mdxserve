import { Text, View } from "react-native";
import { type CalloutProps } from "@mdxserve/shared/builtins/callout";
import { FadeRiseView } from "../primitives/motion";
import { webProps } from "../primitives/web-props";
import { Icon } from "../primitives/Icon";

type Tone = NonNullable<CalloutProps["tone"]>;

const TONES: Record<Tone, { icon: string; bg: string; fg: string; border: string; label: string }> =
	{
		note: {
			icon: "info",
			bg: "bg-status-info-bg",
			fg: "text-status-info-fg",
			border: "border-status-info-fg/22",
			label: "Note",
		},
		tip: {
			icon: "lightbulb",
			bg: "bg-surface-accent-soft",
			fg: "text-text-accent",
			border: "border-text-accent/22",
			label: "Tip",
		},
		ok: {
			icon: "circle-check",
			bg: "bg-status-ok-bg",
			fg: "text-status-ok-fg",
			border: "border-status-ok-fg/22",
			label: "Works",
		},
		warn: {
			icon: "triangle-alert",
			bg: "bg-status-warn-bg",
			fg: "text-status-warn-fg",
			border: "border-status-warn-fg/22",
			label: "Careful",
		},
		danger: {
			icon: "octagon-alert",
			bg: "bg-status-danger-bg",
			fg: "text-status-danger-fg",
			border: "border-status-danger-fg/22",
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

/**
 * A boxed aside with the tone's icon and a bold title. The body is the caller's: on the web it
 * inherits the box's type (its DOM children are not React Native `Text`s), so the box carries
 * the type classes too.
 */
export default function Callout({ tone, type, title, children }: CalloutProps) {
	const resolved = resolveTone({ tone, type });
	const style = TONES[resolved];

	return (
		<FadeRiseView
			className={`not-prose flex-row items-start gap-3 rounded-lg p-4 border ${style.border} font-sans font-medium leading-normal text-[length:var(--size-md)] ${style.bg}`}
		>
			<Icon name={style.icon} size="md" className={`mt-0.5 shrink-0 ${style.fg}`} />
			<View className="min-w-0 flex-1">
				<Text
					{...webProps({ role: "paragraph" })}
					className={`font-sans font-bold leading-normal text-[length:var(--size-md)] tracking-[var(--tracking-snug)] ${style.fg}`}
				>
					{title || style.label}
				</Text>
				<View className="mt-1 web:block leading-6 text-text-body">{children}</View>
			</View>
		</FadeRiseView>
	);
}
