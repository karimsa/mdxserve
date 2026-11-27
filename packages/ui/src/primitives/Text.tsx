import type { ReactNode } from "react";
import { Linking, Text as NativeText, type TextProps as NativeTextProps } from "react-native";
import { webProps } from "./web-props";

const TONES = {
	body: "text-text-body",
	heading: "text-text-heading",
	muted: "text-text-muted",
	subtle: "text-text-subtle",
	accent: "text-text-accent",
} as const;

const SIZES = {
	xs: "text-[length:var(--size-xs)]",
	sm: "text-[length:var(--size-sm)]",
	md: "text-[length:var(--size-md)]",
	prose: "text-[length:var(--size-prose)] leading-[var(--leading-prose)]",
	lg: "text-[length:var(--size-lg)]",
} as const;

const WEIGHTS = {
	regular: "font-normal",
	medium: "font-medium",
	semibold: "font-semibold",
	bold: "font-bold",
} as const;

export interface TextProps extends Omit<NativeTextProps, "role"> {
	tone?: keyof typeof TONES;
	size?: keyof typeof SIZES;
	weight?: keyof typeof WEIGHTS;
	/** A paragraph of its own: a `<p>` on the web. */
	paragraph?: boolean;
	className?: string;
	children?: ReactNode;
}

/**
 * Text in the design's type scale (`--size-*`, Manrope). Each look is a prop, not a class, so
 * a caller never stacks two colour or size classes for Tailwind's order to settle. A `Text`
 * inside a `Text` is a run of the line around it: a `<span>` on the web.
 */
export function Text({
	tone = "body",
	size = "md",
	weight = "regular",
	paragraph = false,
	className = "",
	...props
}: TextProps) {
	return (
		<NativeText
			{...props}
			{...webProps(paragraph ? { role: "paragraph" } : {})}
			className={`font-sans leading-normal ${SIZES[size]} ${WEIGHTS[weight]} ${TONES[tone]} ${className}`}
		/>
	);
}

/** Each level's size, weight and line height (the `--type-h*` tokens). */
const LEVELS = {
	1: "text-[length:var(--size-3xl)] font-bold leading-[1.2]",
	2: "text-[length:var(--size-2xl)] font-bold leading-[1.25]",
	3: "text-[length:var(--size-xl)] font-semibold leading-[1.35]",
	4: "text-[length:var(--size-lg)] font-semibold leading-[1.4]",
	5: "text-[length:var(--size-md)] font-semibold leading-[1.4]",
	6: "text-[length:var(--size-sm)] font-semibold leading-[1.4]",
} as const;

export interface HeadingProps {
	level: keyof typeof LEVELS;
	/** The heading's anchor: its `id` on the web. */
	nativeID?: string;
	className?: string;
	children?: ReactNode;
}

/** A heading: `<h1>`…`<h6>` on the web, a header for VoiceOver in the app. */
export function Heading({ level, nativeID, className = "", children }: HeadingProps) {
	return (
		<NativeText
			role="heading"
			nativeID={nativeID}
			{...webProps({ "aria-level": level })}
			className={`font-sans text-text-heading ${LEVELS[level]} ${className}`}
		>
			{children}
		</NativeText>
	);
}

export interface LinkProps {
	href: string;
	/** Handles the press instead of opening `href` (the app's own routes). */
	onPress?: () => void;
	className?: string;
	children?: ReactNode;
}

/**
 * A link: an `<a href>` on the web, so the browser's own navigation, middle-click and copy
 * link work. In the app, pressing it opens `href` unless `onPress` handles it.
 */
export function Link({ href, onPress, className = "", children }: LinkProps) {
	return (
		<NativeText
			role="link"
			{...webProps({ href })}
			onPress={onPress ?? (() => void Linking.openURL(href))}
			className={`text-text-link web:hover:text-text-link-hover ${className}`}
		>
			{children}
		</NativeText>
	);
}

export interface CodeProps {
	className?: string;
	children?: ReactNode;
}

/** Inline code (the `--type-code-inline` token): a `<code>` on the web. */
export function Code({ className = "", children }: CodeProps) {
	return (
		<NativeText
			{...webProps({ role: "code" })}
			className={`rounded-xs bg-code-bg-inline px-[0.34em] py-[0.12em] font-mono font-medium text-[0.88em] leading-[1.4] text-text-accent ${className}`}
		>
			{children}
		</NativeText>
	);
}
