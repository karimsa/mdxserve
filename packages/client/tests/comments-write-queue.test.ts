import { describe, expect, it } from "vitest";
import { createWriteQueue } from "../comments/write-queue";

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

describe("createWriteQueue", () => {
	it("runs two writes for one key in order", async () => {
		const queue = createWriteQueue();
		const order: string[] = [];
		const first = deferred<string>();
		const one = queue.run("doc", async () => {
			order.push("start one");
			const value = await first.promise;
			order.push("end one");
			return value;
		});
		const two = queue.run("doc", async () => {
			order.push("start two");
			return "two";
		});
		await Promise.resolve();
		expect(order).toEqual(["start one"]);
		first.resolve("one");
		expect(await one).toBe("one");
		expect(await two).toBe("two");
		expect(order).toEqual(["start one", "end one", "start two"]);
	});

	it("keeps going after a failure, which reaches its own caller", async () => {
		const queue = createWriteQueue();
		const failed = queue.run("doc", async () => {
			throw new Error("CONFLICT");
		});
		const next = queue.run("doc", async () => "saved");
		await expect(failed).rejects.toThrow("CONFLICT");
		expect(await next).toBe("saved");
	});

	it("does not hold one key's writes behind another's", async () => {
		const queue = createWriteQueue();
		const blocked = deferred<void>();
		void queue.run("a", () => blocked.promise);
		expect(await queue.run("b", async () => "b")).toBe("b");
		blocked.resolve();
	});
});
