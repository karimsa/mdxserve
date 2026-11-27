// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { z } from "zod";
import DataTable from "../src/builtins/DataTable";
import { DocContext } from "@mdxserve/ui/document/DocContext";
import {
	BlockStateStorageContext,
	useBlockState,
	useDocumentBlockScope,
} from "@mdxserve/ui/block-state/useBlockState";
import {
	blockStateKey,
	createMemoryBlockStorage,
	type BlockStateStorage,
} from "@mdxserve/ui/block-state/storage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	localStorage.clear();
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

async function render(element: ReactNode) {
	await act(async () => root.render(element));
}

const TABLE = {
	id: "costs",
	columns: [
		{ key: "name", label: "Name", type: "text" },
		{ key: "cost", label: "Cost", type: "number" },
	],
	data: [
		{ name: "Beta", cost: 2 },
		{ name: "Alpha", cost: 1 },
	],
} as const;

const TABLE_KEY = blockStateKey({
	documentPath: "/docs/report.md",
	blockId: "costs",
	kind: "table",
	version: 1,
});

function inDocument(element: ReactNode) {
	return createElement(DocContext, { value: { path: "/docs/report.md" } }, element);
}

const firstColumn = () =>
	[...host.querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent);

describe("a DataTable's reader state on the web", () => {
	it("keeps the key and the value format stored before the move to @mdxserve/ui", async () => {
		// What main wrote for a table sorted by Name, ascending.
		localStorage.setItem(
			TABLE_KEY,
			JSON.stringify({
				columnTypes: { name: "text", cost: "number" },
				sort: { key: "name", descending: false },
				filters: {},
				units: {},
			}),
		);
		await render(inDocument(createElement(DataTable, TABLE as never)));
		expect(firstColumn()).toEqual(["Alpha", "Beta"]);

		await act(async () => host.querySelector<HTMLElement>('[aria-label="Clear sorting"]')!.click());
		expect(firstColumn()).toEqual(["Beta", "Alpha"]);
		expect(JSON.parse(localStorage.getItem(TABLE_KEY)!)).toEqual({
			columnTypes: { name: "text", cost: "number" },
			filters: {},
			units: {},
		});
	});

	it("keeps state in the storage a provider supplies instead of localStorage", async () => {
		const storage = createMemoryBlockStorage();
		const table = inDocument(createElement(DataTable, TABLE as never));
		await render(createElement(BlockStateStorageContext, { value: storage }, table));
		await act(async () => {
			const header = host.querySelector<HTMLElement>('[aria-label="Name column header"]')!;
			header.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
		});
		expect(firstColumn()).toEqual(["Alpha", "Beta"]);
		expect(JSON.parse(String(storage.getItem(TABLE_KEY))).sort).toEqual({
			key: "name",
			descending: false,
		});
		expect(localStorage.getItem(TABLE_KEY)).toBeNull();

		// A new mount reads it back.
		act(() => root.unmount());
		root = createRoot(host);
		await render(createElement(BlockStateStorageContext, { value: storage }, table));
		expect(firstColumn()).toEqual(["Alpha", "Beta"]);
	});
});

const counterSchema = z.object({ count: z.number().int() });

function Counter() {
	const scope = useDocumentBlockScope({ blockId: "counter", kind: "counter", version: 1 });
	const [state, setState] = useBlockState(scope, {
		schema: counterSchema,
		initialState: () => ({ count: 0 }),
	});
	return createElement(
		"button",
		{ type: "button", onClick: () => setState((previous) => ({ count: previous.count + 1 })) },
		String(state.count),
	);
}

/** A storage that answers each call later, as AsyncStorage does. */
function asyncStorage(values: Map<string, string>) {
	const pending: Array<() => void> = [];
	const storage: BlockStateStorage = {
		getItem: (key) =>
			new Promise((resolve) => pending.push(() => resolve(values.get(key) ?? null))),
		setItem: async (key, value) => {
			values.set(key, value);
		},
	};
	const flush = async () => {
		await act(async () => {
			while (pending.length) pending.shift()!();
			// Let the answers' promise chains settle inside act.
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	};
	return { storage, flush };
}

describe("useBlockState with an asynchronous storage", () => {
	const key = blockStateKey({
		documentPath: "/docs/report.md",
		blockId: "counter",
		kind: "counter",
		version: 1,
	});

	it("shows the defaults until the saved state arrives, then saves changes", async () => {
		const values = new Map([[key, '{"count":5}']]);
		const { storage, flush } = asyncStorage(values);
		await render(
			createElement(
				BlockStateStorageContext,
				{ value: storage },
				inDocument(createElement(Counter)),
			),
		);
		expect(host.textContent).toBe("0");

		await flush();
		expect(host.textContent).toBe("5");

		await act(async () => host.querySelector("button")!.click());
		expect(host.textContent).toBe("6");
		expect(values.get(key)).toBe('{"count":6}');
	});

	it("drops an answer that arrives after the block unmounted", async () => {
		const values = new Map([[key, '{"count":5}']]);
		const { storage, flush } = asyncStorage(values);
		await render(
			createElement(
				BlockStateStorageContext,
				{ value: storage },
				inDocument(createElement(Counter)),
			),
		);
		act(() => root.unmount());
		await flush();
		root = createRoot(host);
		expect(values.get(key)).toBe('{"count":5}');
	});
});
