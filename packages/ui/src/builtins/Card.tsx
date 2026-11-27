import { Linking, Platform, Text, View, type PressableStateCallbackType } from "react-native";
import { type CardGridProps, type CardProps } from "@mdxserve/shared/builtins/card";
import { Icon } from "../primitives/Icon";
import { Pressable } from "../primitives/Pressable";
import { webProps } from "../primitives/web-props";

/** In the app, pressing shrinks the card a little (the web does it with `active:` classes). */
function pressedStyle({ pressed }: PressableStateCallbackType) {
	return pressed && Platform.OS !== "web" ? { transform: [{ scale: 0.995 }] } : undefined;
}

function CardContent({
	title,
	description,
	icon,
	meta,
	clickable,
	children,
}: Omit<CardProps, "href" | "interactive"> & { clickable: boolean }) {
	return (
		<>
			{icon ? <Icon name={icon} size="lg" className="mb-3 text-text-accent" /> : null}
			{title ? (
				<View className="flex-row items-center gap-2">
					<Text className="web:whitespace-normal font-sans font-semibold leading-[1.4] text-[length:var(--size-md)] text-text-heading">
						{title}
					</Text>
					{clickable ? (
						<View className="opacity-60 web:transition-[transform,opacity] web:duration-150 web:ease-standard web:group-hover:translate-x-0.5 web:group-hover:opacity-100">
							<Icon name="arrow-right" size="sm" className="text-text-subtle" />
						</View>
					) : null}
				</View>
			) : null}
			{description ? (
				<Text
					{...webProps({ role: "paragraph" })}
					className="mt-2 web:whitespace-normal font-sans font-medium text-[length:var(--size-sm)] leading-[1.55] text-text-muted"
				>
					{description}
				</Text>
			) : null}
			{meta ? (
				<Text className="mt-3 web:whitespace-normal font-mono font-semibold leading-[1.2] text-[length:var(--size-2xs)] uppercase tracking-[var(--tracking-wide)] text-text-subtle">
					{meta}
				</Text>
			) : null}
			{children}
		</>
	);
}

/**
 * A bordered card. With `href` it is a link: an `<a href>` on the web, so the browser and the
 * client's router handle it, and in the app pressing it opens `href`; it gives a little when
 * pressed. With `href` or `interactive` it lifts on hover (web).
 */
export default function Card({ href, interactive = false, ...content }: CardProps) {
	const clickable = interactive || Boolean(href);
	const box =
		"not-prose rounded-lg border border-border-default p-5 bg-surface-card shadow-xs text-text-body web:no-underline";
	const lift =
		"group web:cursor-pointer web:transition-[translate,scale,box-shadow] web:duration-150 web:ease-standard web:hover:-translate-y-0.5 web:hover:border-border-accent web:hover:shadow-sm web:active:translate-y-0 web:active:scale-[0.995]";
	const body = <CardContent {...content} clickable={clickable} />;
	if (!href) return <View className={clickable ? `${box} ${lift}` : box}>{body}</View>;

	return (
		<Pressable
			role="link"
			{...webProps({ href })}
			onPress={Platform.OS === "web" ? undefined : () => void Linking.openURL(href)}
			style={pressedStyle}
			className={`${box} ${lift}`}
		>
			{body}
		</Pressable>
	);
}

const GRID_COLUMNS: Record<NonNullable<CardGridProps["columns"]>, string> = {
	"2": "web:sm:grid-cols-2",
	"3": "web:sm:grid-cols-2 web:lg:grid-cols-3",
};

/**
 * Cards side by side on the web (a CSS grid); one under another in the app, which React Native
 * lays out with flexbox only.
 */
export function CardGrid({ columns = "2", children }: CardGridProps) {
	return (
		<View className={`not-prose gap-4 web:grid web:grid-cols-1 ${GRID_COLUMNS[columns]}`}>
			{children}
		</View>
	);
}
