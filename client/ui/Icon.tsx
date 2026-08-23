import { icons, type LucideProps } from "lucide-react";
import type { CSSProperties } from "react";

const SIZES = { sm: 14, md: 16, lg: 20, xl: 24 } as const;

export type IconSize = keyof typeof SIZES | number;

export interface IconProps extends Omit<LucideProps, "size" | "strokeWidth" | "ref"> {
	/** Lucide icon name in kebab-case, e.g. "search", "chevron-right", "file-text". */
	name: string;
	/** 14 / 16 / 20 / 24 px, or an explicit pixel number. Default "md". */
	size?: IconSize;
	/** "light" dims the glyph to 75% for secondary chrome. */
	strokeWidth?: "light";
	style?: CSSProperties;
}

/** "chevron-right" → "ChevronRight" (lucide's `icons` map is keyed by PascalCase). */
function toPascal(name: string): string {
	return name
		.split("-")
		.filter(Boolean)
		.map((part) => part[0]!.toUpperCase() + part.slice(1))
		.join("");
}

/**
 * Lucide (stroke 1.75) is mdxserve's icon set. Components that show icons take a
 * Lucide *name string* so MDX authors can write `icon="rocket"`; this is the one
 * place that turns the name into a glyph. Unknown names render nothing rather
 * than throwing, so a typo in a doc never breaks the page.
 */
export function Icon({ name, size = "md", strokeWidth, style, ...rest }: IconProps) {
	const px = typeof size === "number" ? size : SIZES[size];
	const Glyph = icons[toPascal(name) as keyof typeof icons];
	if (!Glyph) return null;
	return (
		<Glyph
			aria-hidden="true"
			data-icon={name}
			size={px}
			strokeWidth={1.75}
			style={{ flex: "0 0 auto", opacity: strokeWidth === "light" ? 0.75 : undefined, ...style }}
			{...rest}
		/>
	);
}
