import type { DocumentMetadata } from "../src/docs/metadata";

const marker = "data-mdxserve-metadata";

/** Replace only metadata owned by mdxserve; keep the shell's single title element. */
export function applyHeadMetadata(title: string, metadata?: DocumentMetadata): void {
	document.title = metadata?.title ?? title;
	for (const element of document.head.querySelectorAll(`[${marker}]`)) element.remove();
	if (!metadata) return;

	if (metadata.description !== undefined) {
		const description = document.createElement("meta");
		description.name = "description";
		description.content = metadata.description;
		description.setAttribute(marker, "");
		document.head.append(description);
	}
	if (metadata.canonical !== undefined) {
		const canonical = document.createElement("link");
		canonical.rel = "canonical";
		canonical.href = metadata.canonical;
		canonical.setAttribute(marker, "");
		document.head.append(canonical);
	}
	for (const item of metadata.openGraph) {
		const graph = document.createElement("meta");
		graph.setAttribute("property", item.property);
		graph.content = item.content;
		graph.setAttribute(marker, "");
		document.head.append(graph);
	}
}
