import { describe, expect, it } from "vitest";
import type { CommentThread } from "@karimsa/mdxserve/src/comments/schema";
import type { Resolution } from "../comments/anchor";
import { groupThreads } from "../comments/threads";

function thread(id: string, resolved = false): CommentThread {
	return {
		id,
		resolved,
		anchor: { heading: null, block: "block", quote: "quote" },
		messages: [{ id: `${id}-m`, author: "human", body: "Hi" }],
	};
}

const at = (block: number): { resolution: Resolution } => ({
	resolution: { state: "block", block },
});

describe("groupThreads", () => {
	it("orders open threads by document position, ties by list order", () => {
		const threads = [thread("late"), thread("tieA"), thread("early"), thread("tieB")];
		const views = new Map([
			["late", at(9)],
			["tieA", at(4)],
			["early", { resolution: { state: "section", block: -1 } as Resolution }],
			["tieB", at(4)],
		]);
		expect(groupThreads(threads, views).open.map((entry) => entry.id)).toEqual([
			"early",
			"tieA",
			"tieB",
			"late",
		]);
	});

	it("splits out detached and resolved threads, keeping list order", () => {
		const threads = [thread("r1", true), thread("lost"), thread("unplaced"), thread("r2", true)];
		const views = new Map([["lost", { resolution: { state: "detached" } as Resolution }]]);
		const grouped = groupThreads(threads, views);
		expect(grouped.open.map((entry) => entry.id)).toEqual(["unplaced"]);
		expect(grouped.detached.map((entry) => entry.id)).toEqual(["lost"]);
		expect(grouped.resolved.map((entry) => entry.id)).toEqual(["r1", "r2"]);
	});
});
