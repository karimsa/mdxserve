import { describe, expect, it } from "@jest/globals";
import * as fc from "fast-check";
import type { DocumentTree } from "@mdxserve/client/document/tree-types";
import type { ListItemNode } from "@mdxserve/ui/document/environment";
import { setTaskInSource, taskPlaces } from "../src/document/tasks";
import markdownTour from "./fixtures/01-markdown.md.json";

function tasksOf(nodes: readonly unknown[], found: ListItemNode[] = []): ListItemNode[] {
	for (const node of nodes) {
		if (!node || typeof node !== "object") continue;
		const record = node as Record<string, unknown>;
		if (record.type === "list") {
			for (const item of record.items as ListItemNode[]) {
				if (item.checked !== null) found.push(item);
				tasksOf(item.children, found);
			}
		} else {
			if (Array.isArray(record.children)) tasksOf(record.children, found);
			if (Array.isArray(record.tabs))
				for (const tab of record.tabs as { children: unknown[] }[]) tasksOf(tab.children, found);
		}
	}
	return found;
}

function section(id: string, level: 1 | 2 | 3, children: unknown[]) {
	return { type: "section", id, level, heading: [{ type: "text", value: id }], children };
}

function taskList(...checked: boolean[]) {
	return {
		type: "list",
		ordered: false,
		start: null,
		items: checked.map((state) => ({ checked: state, children: [] })),
	};
}

function tree(children: unknown[]): DocumentTree {
	return {
		schemaVersion: 1,
		metadata: { openGraph: [] },
		toc: [],
		children,
	} as unknown as DocumentTree;
}

describe("taskPlaces", () => {
	it("places the example's task list in its section, in order", () => {
		const document = (markdownTour as unknown as { document: DocumentTree }).document;
		const places = taskPlaces(document);
		expect(tasksOf(document.children).map((item) => places.get(item))).toEqual([
			{ ownerId: "lists", ordinal: 0, count: 3 },
			{ ownerId: "lists", ordinal: 1, count: 3 },
			{ ownerId: "lists", ordinal: 2, count: 3 },
		]);
	});

	it("gives a task to its innermost section, which counts the tasks of its subsections too", () => {
		const document = tree([
			{ type: "preamble", id: "~preamble", children: [taskList(false)] },
			section("title", 1, [
				taskList(true),
				section("under-title", 3, [taskList(false)]),
				section("second", 2, [taskList(false, true), section("deeper", 3, [taskList(true)])]),
			]),
		]);
		const places = taskPlaces(document);
		expect(tasksOf(document.children).map((item) => places.get(item))).toEqual([
			{ ownerId: "~preamble", ordinal: 0, count: 1 },
			// A level 1 section's lines stop at its first level 2 subsection.
			{ ownerId: "title", ordinal: 0, count: 2 },
			{ ownerId: "under-title", ordinal: 0, count: 1 },
			{ ownerId: "second", ordinal: 0, count: 3 },
			{ ownerId: "second", ordinal: 1, count: 3 },
			{ ownerId: "deeper", ordinal: 0, count: 1 },
		]);
	});

	it("counts the tasks inside tabs and builtins with their section", () => {
		const document = tree([
			section("setup", 2, [
				{
					type: "tabs",
					id: "os",
					defaultValue: "mac",
					tabs: [
						{ id: "os>mac", value: "mac", label: "macOS", children: [taskList(false)] },
						{ id: "os>linux", value: "linux", label: "Linux", children: [taskList(true)] },
					],
				},
				{ type: "component", id: null, name: "Callout", props: {}, children: [taskList(false)] },
			]),
		]);
		const places = taskPlaces(document);
		expect(tasksOf(document.children).map((item) => places.get(item)?.ordinal)).toEqual([0, 1, 2]);
	});
});

describe("setTaskInSource", () => {
	const source = [
		"## Lists",
		"",
		"- [x] Install Node",
		"  1. [ ] nested, numbered",
		"> * [X] quoted",
		"",
		"```md",
		"- [ ] in a fence",
		"```",
		"",
		"<!--",
		"- [ ] in a comment",
		"-->",
		"{/*",
		"- [ ] in an expression comment",
		"*/}",
		"- [ ] Ship it",
	].join("\n");

	it("changes the one character of the box it is asked for", () => {
		const edit = setTaskInSource(source, { ordinal: 3, count: 4 }, true);
		expect(edit).toEqual({
			kind: "ok",
			markdown: source.replace("- [ ] Ship it", "- [x] Ship it"),
		});
		expect(setTaskInSource(source, { ordinal: 1, count: 4 }, true)).toEqual({
			kind: "ok",
			markdown: source.replace("1. [ ] nested", "1. [x] nested"),
		});
		expect(setTaskInSource(source, { ordinal: 2, count: 4 }, false)).toEqual({
			kind: "ok",
			markdown: source.replace("> * [X] quoted", "> * [ ] quoted"),
		});
	});

	it("writes nothing when the lines do not hold the tasks the tree describes", () => {
		// Another task was added or removed since the tree was read.
		expect(setTaskInSource(source, { ordinal: 3, count: 5 }, true)).toEqual({ kind: "mismatch" });
		// The box is already what the reader asked for.
		expect(setTaskInSource(source, { ordinal: 0, count: 4 }, true)).toEqual({ kind: "mismatch" });
		expect(setTaskInSource(source, { ordinal: 9, count: 4 }, true)).toEqual({ kind: "mismatch" });
	});

	it("does not take a comment delimiter in inline code or escaped for a comment", () => {
		const prose = "Use `<!--` to start a comment, and \\<!-- shows one.\n\n- [ ] Ship it";
		expect(setTaskInSource(prose, { ordinal: 0, count: 1 }, true)).toEqual({
			kind: "ok",
			markdown: prose.replace("- [ ] Ship it", "- [x] Ship it"),
		});
	});

	it("keeps Windows line endings", () => {
		const crlf = "- [ ] one\r\n- [ ] two\r\n";
		expect(setTaskInSource(crlf, { ordinal: 1, count: 2 }, true)).toEqual({
			kind: "ok",
			markdown: "- [ ] one\r\n- [x] two\r\n",
		});
	});

	it("changes exactly one character, the chosen box, for any list of boxes (property)", () => {
		fc.assert(
			fc.property(
				fc.array(fc.record({ checked: fc.boolean(), text: fc.stringMatching(/^[a-z ]{0,12}$/) }), {
					minLength: 1,
					maxLength: 12,
				}),
				fc.nat(),
				(boxes, pick) => {
					const ordinal = pick % boxes.length;
					const markdown = boxes
						.map((box) => `- [${box.checked ? "x" : " "}] ${box.text}`)
						.join("\n");
					const edit = setTaskInSource(
						markdown,
						{ ordinal, count: boxes.length },
						!boxes[ordinal].checked,
					);
					expect(edit.kind).toBe("ok");
					if (edit.kind !== "ok") return;
					expect(edit.markdown).toHaveLength(markdown.length);
					const changed = [...markdown].flatMap((character, at) =>
						edit.markdown[at] === character ? [] : [at],
					);
					expect(changed).toHaveLength(1);
					expect(edit.markdown.split("\n")[ordinal]).toBe(
						`- [${boxes[ordinal].checked ? " " : "x"}] ${boxes[ordinal].text}`,
					);
				},
			),
		);
	});
});
