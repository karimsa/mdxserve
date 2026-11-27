import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { z } from "zod";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocContext } from "@mdxserve/ui/document/DocContext";
import { useBlockState, useDocumentBlockScope } from "@mdxserve/ui/block-state/useBlockState";
import {
	blockStateKey,
	createMemoryBlockStorage,
	restoreBlockState,
	saveBlockState,
	type BlockStateScope,
	type BlockStateStorage,
} from "@mdxserve/ui/block-state/storage";

const scope: BlockStateScope = {
	documentPath: "/docs/report.md",
	blockId: "summary",
	kind: "counter",
	version: 1,
};
const schema = z.object({ count: z.number().int() });

const memoryStorage = createMemoryBlockStorage;

/** The same storage answering through promises, as AsyncStorage does. */
function asyncStorage(): BlockStateStorage & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		getItem: async (key) => values.get(key) ?? null,
		setItem: async (key, value) => {
			values.set(key, value);
		},
	};
}

function StateProbe() {
	const identity = useDocumentBlockScope({ blockId: "summary", kind: "counter", version: 1 });
	const [state] = useBlockState(identity, {
		schema,
		initialState: () => ({ count: 3 }),
		normalize: (saved) => ({ count: Math.min(saved.count, 2) }),
	});
	return createElement("output", { "data-document": identity.documentPath }, state.count);
}

describe("document block persistence", () => {
	it("isolates document, block, kind, and format version", () => {
		const storage = memoryStorage();
		const otherScopes = [
			{ ...scope, documentPath: "/docs/other.md" },
			{ ...scope, blockId: "detail" },
			{ ...scope, kind: "chart" },
			{ ...scope, version: 2 },
		];
		saveBlockState(storage, scope, { count: 7 });

		expect(restoreBlockState(storage, scope, schema)).toEqual({ count: 7 });
		for (const other of otherScopes)
			expect(restoreBlockState(storage, other, schema)).toBeUndefined();
	});

	it("round-trips validated JSON state without sharing mutable objects", () => {
		fc.assert(
			fc.property(fc.integer(), (count) => {
				const storage = memoryStorage();
				const state = { count };
				saveBlockState(storage, scope, state);
				const restored = restoreBlockState(storage, scope, schema);

				expect(restored).toEqual(state);
				expect(restored).not.toBe(state);
			}),
		);
	});

	it("encodes paths and IDs without separator collisions", () => {
		expect(blockStateKey({ ...scope, documentPath: "/a:b", blockId: "c" })).not.toBe(
			blockStateKey({ ...scope, documentPath: "/a", blockId: "b:c" }),
		);
		fc.assert(
			fc.property(fc.string(), fc.string(), (documentPath, blockId) => {
				const identity = { ...scope, documentPath, blockId };
				expect(JSON.parse(blockStateKey(identity).slice("mdxserve:block:".length))).toEqual([
					1,
					"counter",
					documentPath,
					blockId,
				]);
			}),
		);
	});

	it.each(["not json", '{"count":"wrong"}', "null"])("ignores invalid saved data: %s", (saved) => {
		const storage = memoryStorage();
		storage.setItem(blockStateKey(scope), saved);
		expect(restoreBlockState(storage, scope, schema)).toBeUndefined();
	});

	it("migrates legacy keys only when no current value exists", () => {
		const storage = memoryStorage();
		storage.setItem("legacy-counter", '{"count":4}');
		const restored = restoreBlockState(storage, scope, schema, ["legacy-counter"]);
		expect(restored).toEqual({ count: 4 });
		saveBlockState(storage, scope, restored);
		storage.setItem("legacy-counter", '{"count":99}');
		expect(restoreBlockState(storage, scope, schema, ["legacy-counter"])).toEqual({ count: 4 });
		storage.setItem(blockStateKey(scope), "corrupt");
		expect(restoreBlockState(storage, scope, schema, ["legacy-counter"])).toBeUndefined();
	});

	it("tolerates unavailable storage, access failures, and quota errors", () => {
		const unavailable: BlockStateStorage = {
			getItem: () => {
				throw new Error("access denied");
			},
			setItem: () => {
				throw new Error("quota exceeded");
			},
		};
		for (const storage of [undefined, unavailable]) {
			expect(restoreBlockState(storage, scope, schema)).toBeUndefined();
			expect(() => saveBlockState(storage, scope, { count: 1 })).not.toThrow();
		}
	});

	it("does not throw or overwrite existing data for unserializable state", () => {
		const storage = memoryStorage();
		saveBlockState(storage, scope, { count: 1 });
		expect(() => saveBlockState(storage, scope, { count: BigInt(1) })).not.toThrow();
		expect(restoreBlockState(storage, scope, schema)).toEqual({ count: 1 });
	});

	it("uses the document context and normalized defaults during server rendering", () => {
		const html = renderToStaticMarkup(
			createElement(
				DocContext.Provider,
				{ value: { path: scope.documentPath } },
				createElement(StateProbe),
			),
		);
		expect(html).toBe('<output data-document="/docs/report.md">2</output>');
		expect(renderToStaticMarkup(createElement(StateProbe))).toBe(
			'<output data-document="">2</output>',
		);
	});

	it("answers synchronously for a synchronous storage", () => {
		const storage = memoryStorage();
		saveBlockState(storage, scope, { count: 2 });
		expect(restoreBlockState(storage, scope, schema)).toEqual({ count: 2 });
	});
});

describe("document block persistence with an asynchronous storage", () => {
	it("round-trips state and migrates legacy keys only when no current value exists", async () => {
		const storage = asyncStorage();
		storage.values.set("legacy-counter", '{"count":4}');
		await expect(restoreBlockState(storage, scope, schema, ["legacy-counter"])).resolves.toEqual({
			count: 4,
		});
		saveBlockState(storage, scope, { count: 9 });
		await Promise.resolve();
		await expect(restoreBlockState(storage, scope, schema, ["legacy-counter"])).resolves.toEqual({
			count: 9,
		});
		storage.values.set(blockStateKey(scope), "corrupt");
		await expect(
			restoreBlockState(storage, scope, schema, ["legacy-counter"]),
		).resolves.toBeUndefined();
	});

	it("never rejects when the storage rejects", async () => {
		const failing: BlockStateStorage = {
			getItem: () => Promise.reject(new Error("access denied")),
			setItem: () => Promise.reject(new Error("quota exceeded")),
		};
		await expect(restoreBlockState(failing, scope, schema)).resolves.toBeUndefined();
		expect(() => saveBlockState(failing, scope, { count: 1 })).not.toThrow();
		// An unhandled rejection would fail the run.
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
});
