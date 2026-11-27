// One module per glyph: lucide-react-native's entry point would bring every icon into the app.
import CircleCheck from "lucide-react-native/icons/circle-check";
import Info from "lucide-react-native/icons/info";
import Lightbulb from "lucide-react-native/icons/lightbulb";
import OctagonAlert from "lucide-react-native/icons/octagon-alert";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { useResolveClassNames } from "uniwind";

/** The lucide glyph of each callout tone, by its lucide name. */
const GLYPHS = {
	info: Info,
	lightbulb: Lightbulb,
	"circle-check": CircleCheck,
	"triangle-alert": TriangleAlert,
	"octagon-alert": OctagonAlert,
} as const;

export type CalloutIconName = keyof typeof GLYPHS;

export interface CalloutIconProps {
	name: CalloutIconName;
	/** Tailwind classes for the glyph's box; a `text-*` class among them colours its stroke. */
	className: string;
}

/**
 * A callout's 16 px icon (lucide, stroke 1.75, as the web's `Icon` draws it). An SVG glyph
 * takes its colour as a prop, so the `text-*` class is resolved to a value first.
 */
export function CalloutIcon({ name, className }: CalloutIconProps) {
	const Glyph = GLYPHS[name];
	const style = useResolveClassNames(className);
	return (
		<Glyph
			size={16}
			strokeWidth={1.75}
			color={typeof style.color === "string" ? style.color : undefined}
			style={style}
			aria-hidden={true}
		/>
	);
}
