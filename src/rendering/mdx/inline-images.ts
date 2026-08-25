import fs from "node:fs";
import path from "node:path";

// A build-only rehype plugin: `![](./assets/logo.png)` compiles to a literal
// relative `src`, which is broken once the compiled JS lives inside an
// arbitrary out.html far from the doc's own directory. Base64 it in place
// instead, for both a plain hast `img` element and an MDX JSX `<img>`
// (`mdxJsxFlowElement`/`mdxJsxTextElement`).
//
// The MDX JSX node shapes below aren't part of `@types/hast` (they only
// exist in the hast tree mid-pipeline, before hast-util-to-estree converts
// them), so this file declares just enough shape to walk and mutate them.
interface MdxJsxAttributeNode {
	type: string;
	name?: string;
	value?: unknown;
}

interface InlineImageNode {
	type: string;
	tagName?: string;
	name?: string | null;
	properties?: Record<string, unknown>;
	attributes?: MdxJsxAttributeNode[];
	children?: InlineImageNode[];
}

const MIME_BY_EXTENSION: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".avif": "image/avif",
};

export interface RehypeInlineImagesOptions {
	/** Directory a relative image `src` resolves against — the doc's own directory. */
	base: string;
	/** Called once per image that could not be inlined (file missing/unreadable, or an unrecognized extension). */
	onWarning?: (message: string) => void;
}

function isInlineCandidate(src: string): boolean {
	// http(s):, data:, protocol-relative, in-page anchors, and root-absolute
	// paths are either already portable or not resolvable against `base`.
	return !/^(https?:|data:|\/\/|#|\/)/.test(src);
}

function inlineSrc(src: string, options: RehypeInlineImagesOptions): string | undefined {
	if (!isInlineCandidate(src)) return undefined;
	const file = path.resolve(options.base, decodeURIComponent(src));
	const mime = MIME_BY_EXTENSION[path.extname(file).toLowerCase()];
	if (!mime) {
		options.onWarning?.(`image not inlined (unrecognized extension): ${src}`);
		return undefined;
	}
	try {
		return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
	} catch {
		options.onWarning?.(`image not found: ${src}`);
		return undefined;
	}
}

function walk(node: InlineImageNode, visit: (node: InlineImageNode) => void): void {
	visit(node);
	for (const child of node.children ?? []) walk(child, visit);
}

function inlineNode(node: InlineImageNode, options: RehypeInlineImagesOptions): void {
	if (
		node.type === "element" &&
		node.tagName === "img" &&
		typeof node.properties?.src === "string"
	) {
		const inlined = inlineSrc(node.properties.src, options);
		if (inlined) node.properties.src = inlined;
		return;
	}
	if (
		(node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
		node.name === "img"
	) {
		for (const attribute of node.attributes ?? []) {
			if (
				attribute.type === "mdxJsxAttribute" &&
				attribute.name === "src" &&
				typeof attribute.value === "string"
			) {
				const inlined = inlineSrc(attribute.value, options);
				if (inlined) attribute.value = inlined;
			}
		}
	}
}

/**
 * A rehype plugin factory called directly (`rehypeInlineImages({ base,
 * onWarning })`), not through unified's `.use(plugin, options)` form: the
 * value it returns is placed bare in a `rehypePlugins` array, and unified
 * invokes whatever it finds there with zero arguments to obtain the actual
 * per-file transformer — so this must return that zero-argument "attacher",
 * not the transformer itself.
 */
export function rehypeInlineImages(
	options: RehypeInlineImagesOptions,
): () => (tree: unknown) => void {
	return function attachInlineImages() {
		return function transformInlineImages(tree: unknown): void {
			walk(tree as InlineImageNode, (node) => inlineNode(node, options));
		};
	};
}
