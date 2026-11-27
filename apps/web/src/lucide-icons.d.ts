// lucide-react ships one .mjs file per icon under dist/esm/icons/ (no .d.ts
// alongside them) so a deep import like
// `import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs"` has no
// type on its own. This ambient module covers every such deep import with the
// same shape lucide-react's own named exports use.
declare module "lucide-react/dist/esm/icons/*" {
	const icon: import("lucide-react").LucideIcon;
	export default icon;
}
