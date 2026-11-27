import TextAncestorContext from "react-native-web/dist/exports/Text/TextAncestorContext";
import type { InlineProps } from "./Inline";

/**
 * The web's `Inline`: a `<span>` (or a `<kbd>`), since react-native-web renders every `View` as
 * a `<div>`, which may not sit inside a `<p>`. It also tells the `Text`s inside it that they are
 * in a line of text, so they render as `<span>`s that inherit its font rather than as `<div>`s.
 */
export function Inline({
	className,
	element: Element = "span",
	children,
	"aria-hidden": ariaHidden,
}: InlineProps) {
	return (
		<TextAncestorContext.Provider value={true}>
			<Element className={className} aria-hidden={ariaHidden}>
				{children}
			</Element>
		</TextAncestorContext.Provider>
	);
}
