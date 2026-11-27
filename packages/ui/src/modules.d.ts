// react-native-web publishes no types for its internal modules. This is the one Inline.web.tsx
// reads: the context its `Text` uses to decide between a `<div>` and a nested `<span>`.
declare module "react-native-web/dist/exports/Text/TextAncestorContext" {
	const TextAncestorContext: import("react").Context<boolean>;
	export default TextAncestorContext;
}

// lucide-react ships one .mjs file per icon with no .d.ts beside it (CalloutIcon.web.tsx
// imports them one by one); each has the shape of lucide-react's named exports.
declare module "lucide-react/dist/esm/icons/*" {
	const icon: import("lucide-react").LucideIcon;
	export default icon;
}
