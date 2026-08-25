// The explicit .mjs extension matters: this module is also reachable from
// scripts/build-registry.ts under plain Node, whose ESM resolver (unlike
// Vite's) requires a real extension since lucide-react's package.json has no
// "exports" map for this subpath.
import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";
import type { LucideIcon, LucideProps } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { staticIcons } from "./icon-set";

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

type DynamicIconName = keyof typeof dynamicIconImports;

function isDynamicIconName(name: string): name is DynamicIconName {
	return Object.hasOwn(dynamicIconImports, name);
}

// Module-level so every Icon instance sharing a name shares one load: a
// resolved glyph (or `null` for a name that turned out to have no default
// export) sits in `resolved`, an in-flight import sits in `pending` until it
// settles.
const resolved = new Map<string, LucideIcon | null>();
const pending = new Map<string, Promise<LucideIcon | null>>();

function loadDynamicIcon(name: DynamicIconName): Promise<LucideIcon | null> {
	const cached = resolved.get(name);
	if (cached !== undefined) return Promise.resolve(cached);
	const inFlight = pending.get(name);
	if (inFlight) return inFlight;

	const promise = dynamicIconImports[name]()
		.then((mod) => mod.default ?? null)
		.catch(() => null)
		.then((glyph) => {
			resolved.set(name, glyph);
			pending.delete(name);
			return glyph;
		});
	pending.set(name, promise);
	return promise;
}

/**
 * Lucide (stroke 1.75) is mdxserve's icon set. Components that show icons take a
 * Lucide *name string* so MDX authors can write `icon="rocket"`; this is the one
 * place that turns the name into a glyph. Unknown names render nothing rather
 * than throwing, so a typo in a doc never breaks the page.
 *
 * Two tiers: `staticIcons` (client/ui/icon-set.ts) covers the ~30 names
 * mdxserve's own chrome uses, resolved synchronously with no import at all.
 * Any other name is looked up in lucide-react's `dynamicIconImports` map and
 * loaded on demand — this is how MDX authors can write `icon="anything-in-
 * lucide"` without every one of lucide's 2,022 icons shipping in the bundle.
 * While a dynamic icon is loading, a same-size empty placeholder holds its
 * layout so nothing shifts once the glyph lands.
 */
export function Icon({ name, size = "md", strokeWidth, style, ...rest }: IconProps) {
	const px = typeof size === "number" ? size : SIZES[size];
	const opacity = strokeWidth === "light" ? 0.75 : undefined;

	const StaticGlyph = staticIcons[name];
	const dynamic = !StaticGlyph && isDynamicIconName(name);
	const [DynamicGlyph, setDynamicGlyph] = useState<LucideIcon | null>(() =>
		dynamic ? (resolved.get(name) ?? null) : null,
	);

	useEffect(() => {
		if (!dynamic) return;
		if (resolved.has(name)) {
			setDynamicGlyph(resolved.get(name) ?? null);
			return;
		}
		let cancelled = false;
		loadDynamicIcon(name).then((glyph) => {
			if (!cancelled) setDynamicGlyph(glyph);
		});
		return () => {
			cancelled = true;
		};
	}, [dynamic, name]);

	const Glyph = StaticGlyph ?? (dynamic ? DynamicGlyph : null);

	if (!StaticGlyph && !dynamic) return null;

	if (!Glyph) {
		// Unresolved dynamic icon: still loading. Same footprint as the glyph
		// it will become so nothing reflows once it lands.
		return <svg aria-hidden="true" width={px} height={px} style={{ flex: "0 0 auto", ...style }} />;
	}

	return (
		<Glyph
			aria-hidden="true"
			data-icon={name}
			size={px}
			strokeWidth={1.75}
			style={{ flex: "0 0 auto", opacity, ...style }}
			{...rest}
		/>
	);
}
