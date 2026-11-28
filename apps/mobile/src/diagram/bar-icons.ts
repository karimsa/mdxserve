import type { ImageSourcePropType } from "react-native";
import type { FlowDirection } from "@mdxserve/shared/mermaid-direction";
import arrowDown from "../../assets/bar-icons/arrow-down.png";
import arrowLeft from "../../assets/bar-icons/arrow-left.png";
import arrowRight from "../../assets/bar-icons/arrow-right.png";
import arrowUp from "../../assets/bar-icons/arrow-up.png";
import code from "../../assets/bar-icons/code.png";
import maximize from "../../assets/bar-icons/maximize.png";
import minus from "../../assets/bar-icons/minus.png";
import plus from "../../assets/bar-icons/plus.png";
import close from "../../assets/bar-icons/x.png";

/**
 * The full screen view's bar icons: the lucide glyphs the inline controls draw, rendered by
 * scripts/render-bar-icons.mjs at one size and stroke, so the items match those controls and
 * one another. The bar tints them as templates.
 */
export const BAR_ICONS: Record<
	"zoomIn" | "reset" | "zoomOut" | "source" | "done",
	ImageSourcePropType
> = { zoomIn: plus, reset: maximize, zoomOut: minus, source: code, done: close };

/** The arrow for each layout, as the inline layout control draws it. */
export const DIRECTION_ICONS: Record<FlowDirection, ImageSourcePropType> = {
	TB: arrowDown,
	BT: arrowUp,
	LR: arrowRight,
	RL: arrowLeft,
};
