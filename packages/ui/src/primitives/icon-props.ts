/** 14 / 16 / 20 / 24 px. */
const ICON_SIZES = { sm: 14, md: 16, lg: 20, xl: 24 } as const;

export interface IconProps {
	/** Lucide icon name in kebab-case, e.g. "search", "chevron-right", "file-text". */
	name: string;
	/** A named size or an explicit pixel number. Default "md". */
	size?: keyof typeof ICON_SIZES | number;
	/** "light" dims the glyph to 75% for secondary chrome. */
	strokeWidth?: "light";
	/** Tailwind classes for the glyph; a `text-*` class among them colours its stroke. */
	className?: string;
}

/** The pixel size an `IconProps.size` names. */
export function iconPixels(size: IconProps["size"] = "md"): number {
	return typeof size === "number" ? size : ICON_SIZES[size];
}
