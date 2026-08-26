import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { nextCount } from "../../client/ui/toast-count.js";

type Operation = { kind: "push"; id: string } | { kind: "remove"; id: string };

const id = fc.constantFrom("a", "b", "c");
const operationArbitrary = fc.oneof(
	id.map((chosenId): Operation => ({ kind: "push", id: chosenId })),
	id.map((chosenId): Operation => ({ kind: "remove", id: chosenId })),
);
const operations = fc.array(operationArbitrary, { maxLength: 30 });

describe("nextCount", () => {
	it("tracks the push streak since an id was last absent from live, keeping counts scoped to live ids", () => {
		fc.assert(
			fc.property(operations, (ops) => {
				const live = new Set<string>();
				const counts = new Map<string, number>();
				// Mirrors `counts` in the test: how many consecutive pushes an id
				// has absorbed since it was last missing from `live`.
				const streaks = new Map<string, number>();

				for (const operation of ops) {
					if (operation.kind === "remove") {
						live.delete(operation.id);
						streaks.delete(operation.id);
						continue;
					}
					const expected = live.has(operation.id) ? (streaks.get(operation.id) ?? 1) + 1 : 1;
					const liveBeforePush = new Set(live);
					const actual = nextCount(live, counts, operation.id);
					expect(actual).toBe(expected);
					streaks.set(operation.id, expected);
					live.add(operation.id);

					for (const key of counts.keys()) {
						expect(liveBeforePush.has(key) || key === operation.id).toBe(true);
					}
				}
			}),
		);
	});
});
