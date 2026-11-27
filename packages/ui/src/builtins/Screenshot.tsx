import { useState, type ReactNode } from "react";
import { Platform, Text, View } from "react-native";
import { type ScreenshotProps } from "@mdxserve/shared/builtins/screenshot";
import { ExpandButton, ScreenshotCaption, ScreenshotImage } from "./screenshot-parts";
import { ScreenshotViewer } from "./ScreenshotViewer";

// macOS traffic-light colours; the same in both themes, like the real thing.
const TRAFFIC_LIGHTS = ["#ff5f57", "#febc2e", "#28c840"];

/** What the full-screen view of a screenshot gets. */
export interface ExpandedScreenshot {
	open: boolean;
	onClose(): void;
	src: string;
	alt: string;
	title?: string;
}

interface Props extends ScreenshotProps {
	/**
	 * The full-screen view, open while `open` is true. The web client passes its expand modal;
	 * without one the app's `ScreenshotViewer` is used.
	 */
	renderExpanded?(view: ExpandedScreenshot): ReactNode;
}

/** React Native's `maxWidth` takes a number or a percentage; the web takes any CSS length. */
function maxWidthOf(width: ScreenshotProps["width"]) {
	if (width === undefined) return undefined;
	if (Platform.OS === "web" || typeof width === "number" || /^\d+(\.\d+)?%$/.test(width))
		return { maxWidth: width as number };
	return undefined;
}

/**
 * An image in a macOS window frame: traffic lights, the window's title, an expand control,
 * then the image and an optional caption. A `<figure>` on the web.
 */
export default function Screenshot({
	src,
	alt = "",
	title,
	caption,
	width,
	renderExpanded,
}: Props) {
	const [expanded, setExpanded] = useState(false);
	const view: ExpandedScreenshot = {
		open: expanded,
		onClose: () => setExpanded(false),
		src,
		alt,
		title,
	};

	return (
		<View
			role="figure"
			className="not-prose mx-auto w-full overflow-hidden rounded-lg border border-border-default bg-surface-card shadow-md"
			style={maxWidthOf(width)}
		>
			<View className="relative h-[34px] flex-row items-center border-b border-border-subtle bg-surface-raised px-3">
				<View className="flex-row items-center gap-2" aria-hidden={true}>
					{TRAFFIC_LIGHTS.map((color) => (
						<View
							key={color}
							className="size-3 rounded-full border border-black/10"
							style={{ backgroundColor: color }}
						/>
					))}
				</View>
				{title ? (
					<Text
						numberOfLines={Platform.OS === "web" ? undefined : 1}
						className="pointer-events-none absolute inset-x-16 web:truncate text-center font-sans font-medium leading-[1.62] text-[length:var(--size-xs)] text-text-subtle"
					>
						{title}
					</Text>
				) : null}
				<ExpandButton onPress={() => setExpanded(true)} />
			</View>
			<ScreenshotImage src={src} alt={alt} />
			{caption ? <ScreenshotCaption>{caption}</ScreenshotCaption> : null}
			{renderExpanded ? renderExpanded(view) : <ScreenshotViewer {...view} />}
		</View>
	);
}
