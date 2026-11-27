// One file per glyph: lucide-react's entry point would pull in its whole icon map (see the web
// client's ui/icon-set.ts, which imports the same files).
import CircleCheck from "lucide-react/dist/esm/icons/circle-check.mjs";
import Info from "lucide-react/dist/esm/icons/info.mjs";
import Lightbulb from "lucide-react/dist/esm/icons/lightbulb.mjs";
import OctagonAlert from "lucide-react/dist/esm/icons/octagon-alert.mjs";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert.mjs";
import type { CalloutIconProps } from "./CalloutIcon";

const GLYPHS = {
	info: Info,
	lightbulb: Lightbulb,
	"circle-check": CircleCheck,
	"triangle-alert": TriangleAlert,
	"octagon-alert": OctagonAlert,
} as const;

/** The web's callout icon: lucide-react's DOM `<svg>`, the element the web client's `Icon` renders. */
export function CalloutIcon({ name, className }: CalloutIconProps) {
	const Glyph = GLYPHS[name];
	return (
		<Glyph
			aria-hidden="true"
			data-icon={name}
			size={16}
			strokeWidth={1.75}
			style={{ flex: "0 0 auto" }}
			className={className}
		/>
	);
}
