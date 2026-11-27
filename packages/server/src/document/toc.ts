import type { BlockNode, InlineNode, TabNode, TocEntry } from "./schema.js";

type Mode = "root" | "tab" | "nested";

/**
 * The table of contents of a converted document: sections of level 2 and 3
 * in the root, nested by level; each tab of a `Tabs` one level below the
 * section that contains it; and sections of any level inside a tab body
 * below that tab. Sections inside other containers (a `Callout`, a list) are
 * left out, but a `Tabs` inside one still lists its tabs.
 */
export function buildToc(children: BlockNode[]): TocEntry[] {
	const entries: TocEntry[] = [];
	collect(children, entries, "root");
	return entries;
}

function collect(nodes: readonly (BlockNode | InlineNode)[], into: TocEntry[], mode: Mode): void {
	for (const node of nodes) {
		switch (node.type) {
			case "section": {
				const listed =
					mode === "tab" || (mode === "root" && (node.level === 2 || node.level === 3));
				if (listed) {
					const entry: TocEntry = {
						id: node.id,
						label: inlineText(node.heading),
						kind: "heading",
						children: [],
					};
					into.push(entry);
					collect(node.children, entry.children, mode);
				} else {
					collect(node.children, into, mode);
				}
				break;
			}
			case "error": {
				// A section that failed to parse stays reachable from the contents,
				// so the reader can find what needs fixing.
				const heading = mode === "root" ? failedHeading(node.source) : null;
				if (heading) into.push({ id: node.id, label: heading, kind: "heading", children: [] });
				break;
			}
			case "preamble":
				collect(node.children, into, mode);
				break;
			case "tabs":
				for (const tab of node.tabs) into.push(tabEntry(tab));
				break;
			case "blockquote":
			case "footnoteDefinition":
			case "component":
			case "element":
				collect(node.children, into, "nested");
				break;
			case "list":
				for (const item of node.items) collect(item.children, into, "nested");
				break;
			default:
				break;
		}
	}
}

/** The text of the h2 or h3 heading line a failed section starts with, or null. */
function failedHeading(source: string): string | null {
	const firstLine = source.split(/\r\n|\r|\n/, 1)[0] ?? "";
	const match = /^ {0,3}#{2,3}(?=[ \t]|$)(.*)$/.exec(firstLine);
	if (!match) return null;
	const text = match[1].replace(/[ \t]+#+[ \t]*$/, "").trim();
	return text === "" ? null : text;
}

function tabEntry(tab: TabNode): TocEntry {
	const entry: TocEntry = { id: tab.id, label: tab.label, kind: "tab", children: [] };
	collect(tab.children, entry.children, "tab");
	return entry;
}

/** The plain text of inline nodes, the way a heading reads as a table of contents label. */
function inlineText(nodes: readonly (InlineNode | BlockNode)[]): string {
	let text = "";
	for (const node of nodes) {
		switch (node.type) {
			case "text":
			case "inlineCode":
				text += node.value;
				break;
			case "emphasis":
			case "strong":
			case "delete":
			case "link":
			case "component":
			case "element":
			case "paragraph":
				text += inlineText(node.children);
				break;
			default:
				break;
		}
	}
	return text;
}
