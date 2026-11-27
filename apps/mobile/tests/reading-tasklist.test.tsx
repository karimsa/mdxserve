import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import type { TreeNode } from "@mdxserve/client/document/tree-types";
import { TaskBox } from "@mdxserve/ui/document/elements";
import {
	DocumentEnvironmentProvider,
	type DocumentEnvironment,
} from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import { appDocumentEnvironment } from "../src/document-environment";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

const sheet = loadCompiledStylesheet();

const text = (value: string) => ({ type: "text", value });
const item = (checked: boolean | null, value: string, ...more: unknown[]) => ({
	checked,
	children: [{ type: "paragraph", children: [text(value)] }, ...more],
});
const list = (ordered: boolean, ...items: unknown[]) => ({
	type: "list",
	ordered,
	start: null,
	items,
});

/** A checklist, a nested checklist under its first item, and a list mixing tasks and ordinary items. */
const DOCUMENT = [
	list(
		false,
		item(true, "Install Node", list(false, item(false, "Nested task"))),
		item(false, "Ship it, a task long enough to wrap onto a second line on a narrow screen"),
	),
	list(true, item(null, "Numbered"), item(true, "Numbered task"), item(null, "Numbered again")),
	list(false, item(null, "Plain bullet"), item(false, "Bulleted task")),
] as unknown as TreeNode[];

function flat(element: { props: { style?: unknown } }): Record<string, unknown> {
	return StyleSheet.flatten(element.props.style as never) ?? {};
}

/** The drawn box inside a checkbox: the 20 pt view. */
function boxOf(checkbox: unknown) {
	const boxes: { props: { style?: unknown } }[] = [];
	const visit = (node: unknown) => {
		if (!node || typeof node !== "object") return;
		const host = node as { props: { style?: unknown }; children?: unknown[] };
		if (host !== checkbox && flat(host).width === 20 && flat(host).height === 20) boxes.push(host);
		for (const child of host.children ?? []) visit(child);
	};
	visit(checkbox);
	expect(boxes).toHaveLength(1);
	return flat(boxes[0]);
}

async function draw(environment: DocumentEnvironment = appDocumentEnvironment) {
	return render(
		<DocumentEnvironmentProvider value={environment}>
			<NodeList nodes={DOCUMENT} />
		</DocumentEnvironmentProvider>,
	);
}

describe.each(["light", "dark"] as const)("a task list in the app (%s)", (theme) => {
	const { variables } = resolveTheme(sheet, theme);
	// The prose's line box: `--size-prose` × `--leading-prose`, as a paragraph draws it.
	const proseLine =
		Number.parseFloat(String(variables["--size-prose"])) *
		Number.parseFloat(String(variables["--leading-prose"]));

	it("draws the checkbox as the item's marker: no bullet or number beside it", async () => {
		Uniwind.setTheme(theme);
		await draw();
		// Ordinary items keep theirs: one bullet for "Plain bullet", numbers 1 and 3 in the ordered list.
		expect(screen.getAllByText("•")).toHaveLength(1);
		expect(screen.getByText("1.")).toBeOnTheScreen();
		expect(screen.queryByText("2.")).toBeNull();
		expect(screen.getByText("3.")).toBeOnTheScreen();
		expect(screen.getAllByRole("checkbox")).toHaveLength(5);
	});

	it("fills a checked box with the accent and outlines an empty one, from the tokens", async () => {
		Uniwind.setTheme(theme);
		await draw();
		const checked = boxOf(screen.getAllByRole("checkbox", { checked: true })[0]);
		expect(checked.backgroundColor).toBe(variables["--surface-accent"]);
		expect(checked.borderRadius).toBe(4);
		const empty = boxOf(screen.getAllByRole("checkbox", { checked: false })[0]);
		expect(empty.backgroundColor).toBeUndefined();
		expect(empty.borderWidth).toBe(2);
		expect(empty.borderColor).toBe(variables["--text-subtle"]);
	});

	it("centres the box on the item's first line, beside the text, which wraps under itself", async () => {
		Uniwind.setTheme(theme);
		await draw();
		expect(proseLine).toBeCloseTo(28.38, 1);
		const checkbox = screen.getAllByRole("checkbox")[0];
		expect(flat(checkbox).height).toBeCloseTo(proseLine, 1);
		expect(flat(checkbox)).toMatchObject({ width: 20, justifyContent: "center" });
		// The row: the box, then a column holding the item's text and its nested list.
		const row = checkbox.parent;
		expect(row?.props.role).toBe("listitem");
		expect(flat(row as never).flexDirection).toBe("row");
		expect(within(row as never).getByText("Install Node")).toBeOnTheScreen();
		expect(within(row as never).getByText("Nested task")).toBeOnTheScreen();
	});

	it("can be ticked through a 44 pt target, read by VoiceOver with its text, or dimmed when it cannot", async () => {
		Uniwind.setTheme(theme);
		const onToggle = jest.fn();
		await draw({
			...appDocumentEnvironment,
			renderTaskBox: (task) => (
				<TaskBox
					checked={task.checked === true}
					onToggle={task.checked ? onToggle : undefined}
					disabled={!task.checked}
					label={`task ${String(task.checked)}`}
				/>
			),
		});
		const ticked = screen.getAllByLabelText("task true")[0];
		const { height, width } = flat(ticked) as { height: number; width: number };
		const { top, bottom, left, right } = ticked.props.hitSlop;
		expect(height + top + bottom).toBeGreaterThanOrEqual(44);
		expect(width + left + right).toBeGreaterThanOrEqual(44);
		await fireEvent.press(ticked);
		expect(onToggle).toHaveBeenCalled();
		const dimmed = screen.getAllByLabelText("task false")[0];
		expect(dimmed).toBeDisabled();
		expect(boxOf(dimmed).opacity).toBe(0.5);
	});
});
