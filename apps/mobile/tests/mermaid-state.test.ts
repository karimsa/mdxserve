import { describe, expect, it } from "@jest/globals";
import * as fc from "fast-check";
import {
	diagramReducer,
	initialDiagramState,
	type DiagramEvent,
	type DiagramState,
} from "../src/diagram/state";

const SIZE = { width: 400, height: 200 };

function drawn(overrides: Partial<Extract<DiagramState, { kind: "drawn" }>> = {}): DiagramState {
	return {
		kind: "drawn",
		nodeId: "a",
		requestKey: "k1",
		size: SIZE,
		title: null,
		description: null,
		pending: false,
		...overrides,
	};
}

const loading: DiagramState = { kind: "loading", nodeId: "a", requestKey: "k1" };
const failed: DiagramState = { kind: "failed", nodeId: "a", requestKey: "k1", message: "bad" };
const unavailable: DiagramState = { kind: "unavailable", nodeId: "a", requestKey: "k1" };

describe("diagramReducer", () => {
	it("keeps a drawing at its size while the same block's new request draws (M14)", () => {
		expect(diagramReducer(drawn(), { kind: "request", nodeId: "a", requestKey: "k2" })).toEqual(
			drawn({ requestKey: "k2", pending: true }),
		);
	});

	it.each([loading, failed, unavailable])(
		"starts over for a new request of the same block from $kind",
		(state) => {
			expect(diagramReducer(state, { kind: "request", nodeId: "a", requestKey: "k2" })).toEqual({
				kind: "loading",
				nodeId: "a",
				requestKey: "k2",
			});
		},
	);

	it.each([drawn(), loading, failed, unavailable])(
		"never shows a drawing for another block (M15), from $kind",
		(state) => {
			expect(diagramReducer(state, { kind: "request", nodeId: "b", requestKey: "k1" })).toEqual({
				kind: "loading",
				nodeId: "b",
				requestKey: "k1",
			});
		},
	);

	it.each([drawn(), loading, failed, unavailable])(
		"ignores a repeat of the current request, from $kind",
		(state) => {
			expect(diagramReducer(state, { kind: "request", nodeId: "a", requestKey: "k1" })).toBe(state);
		},
	);

	it("draws the current request", () => {
		const event: DiagramEvent = {
			kind: "rendered",
			requestKey: "k1",
			size: { width: 10, height: 20 },
			title: "T",
			description: "D",
		};
		expect(diagramReducer(loading, event)).toEqual(
			drawn({ size: { width: 10, height: 20 }, title: "T", description: "D" }),
		);
		expect(diagramReducer(drawn({ pending: true }), event)).toEqual(
			drawn({ size: { width: 10, height: 20 }, title: "T", description: "D" }),
		);
	});

	it("fails on an error for the current request", () => {
		expect(diagramReducer(loading, { kind: "error", requestKey: "k1", message: "bad" })).toEqual(
			failed,
		);
	});

	it.each([loading, drawn({ pending: true })])("times out from $kind", (state) => {
		expect(diagramReducer(state, { kind: "timeout", requestKey: "k1" })).toEqual(unavailable);
	});

	it.each([drawn(), failed, unavailable])("does not time out from a settled $kind", (state) => {
		expect(diagramReducer(state, { kind: "timeout", requestKey: "k1" })).toBe(state);
	});

	it.each([unavailable, failed])("tries again from $kind", (state) => {
		expect(diagramReducer(state, { kind: "retry" })).toEqual(loading);
	});

	it.each([loading, drawn()])("ignores Try again from $kind", (state) => {
		expect(diagramReducer(state, { kind: "retry" })).toBe(state);
	});

	it.each([
		{ kind: "rendered", requestKey: "old", size: SIZE, title: null, description: null },
		{ kind: "error", requestKey: "old", message: "bad" },
		{ kind: "timeout", requestKey: "old" },
	] as DiagramEvent[])("ignores a $kind for another request (MS3)", (event) => {
		for (const state of [loading, drawn(), failed, unavailable])
			expect(diagramReducer(state, event)).toBe(state);
	});
});

const nodeId = fc.constantFrom("a", "b");
const requestKey = fc.constantFrom("k1", "k2", "k3");
const size = fc.record({
	width: fc.integer({ min: 1, max: 5000 }),
	height: fc.integer({ min: 1, max: 5000 }),
});
const event: fc.Arbitrary<DiagramEvent> = fc.oneof(
	fc.record({ kind: fc.constant("request" as const), nodeId, requestKey }),
	fc.record({
		kind: fc.constant("rendered" as const),
		requestKey,
		size,
		title: fc.option(fc.string()),
		description: fc.option(fc.string()),
	}),
	fc.record({ kind: fc.constant("error" as const), requestKey, message: fc.string() }),
	fc.record({ kind: fc.constant("timeout" as const), requestKey }),
	fc.constant({ kind: "retry" as const }),
);

describe("diagramReducer, for any sequence of events", () => {
	it("keeps its guarantees", () => {
		fc.assert(
			fc.property(fc.array(event, { maxLength: 40 }), (events) => {
				let state = initialDiagramState("a", "k1");
				for (const next of events) {
					const after = diagramReducer(state, next);
					if (
						next.kind !== "request" &&
						next.kind !== "retry" &&
						next.requestKey !== state.requestKey
					)
						expect(after).toBe(state);
					if (after.kind === "drawn" && state.kind !== "drawn")
						expect(next.kind === "rendered" && next.requestKey === state.requestKey).toBe(true);
					if (next.kind === "request" && next.nodeId !== state.nodeId)
						expect(after.kind).toBe("loading");
					if (
						next.kind === "request" &&
						state.kind === "drawn" &&
						next.nodeId === state.nodeId &&
						after.kind === "drawn"
					)
						expect(after.size).toBe(state.size);
					expect(after.nodeId).toBe(next.kind === "request" ? next.nodeId : state.nodeId);
					state = after;
				}
			}),
		);
	});
});
