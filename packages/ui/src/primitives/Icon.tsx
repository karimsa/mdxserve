import type { LucideIcon } from "lucide-react-native";
import * as glyphs from "lucide-react-native/icons";
import { useResolveClassNames } from "uniwind";
import { iconPixels, type IconProps } from "./icon-props";

/** "chevron-right" → `ChevronRight`, the name lucide-react-native exports the glyph under. */
function glyphFor(name: string): LucideIcon | null {
	const exportName = name
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
	return (glyphs as Record<string, LucideIcon | undefined>)[exportName] ?? null;
}

/**
 * Lucide (stroke 1.75) by kebab-case name, as the web's `Icon` (Icon.web.tsx) takes it, so an
 * author's `icon="rocket"` draws the same glyph in both clients. Every lucide icon ships in the
 * app: Metro has no lazy chunks to load an author's choice from. An unknown name renders
 * nothing. An SVG glyph takes its colour as a prop, so the `text-*` class is resolved first.
 */
export function Icon({ name, size, strokeWidth, className = "" }: IconProps) {
	const style = useResolveClassNames(className);
	const Glyph = glyphFor(name);
	if (!Glyph) return null;
	return (
		<Glyph
			size={iconPixels(size)}
			strokeWidth={1.75}
			color={typeof style.color === "string" ? style.color : undefined}
			style={[style, { opacity: strokeWidth === "light" ? 0.75 : 1 }]}
			aria-hidden={true}
		/>
	);
}
