// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MermaidDialog } from "../../client/diagrams/Dialog";
const rpc = vi.hoisted(() => ({
	convert: vi.fn(),
	cancel: vi.fn(),
	release: vi.fn(),
	preferences: vi.fn(),
}));
vi.mock("../../client/api", () => ({
	trpcClient: {
		getDiagramPreferences: { query: rpc.preferences },
		convertDiagram: { mutate: rpc.convert },
		cancelDiagramConversion: { mutate: rpc.cancel },
		releaseDiagramSession: { mutate: rpc.release },
	},
}));
vi.mock("../../client/Mermaid", async () => {
	const { useEffect } = await import("react");
	return {
		MermaidDiagram: ({
			source,
			onRender,
		}: {
			source: string;
			onRender: (source: string, valid: boolean) => void;
		}) => {
			useEffect(() => onRender(source, true), [source, onRender]);
			return createElement("div", { "data-preview": true }, source);
		},
	};
});
let root: Root;
let host: HTMLDivElement;
const result = {
	mermaid: "erDiagram\n CUSTOMER ||--o{ ORDER : places",
	assumptions: [],
	changes: [],
	provider: "codex",
};
beforeEach(async () => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	rpc.preferences.mockResolvedValue({
		agent: "codex",
		models: { codex: "gpt-6-luna", claude: "haiku" },
		configured: true,
	});
	rpc.cancel.mockResolvedValue(null);
	rpc.release.mockResolvedValue(null);
	rpc.convert.mockResolvedValue(result);
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () =>
		root.render(createElement(MermaidDialog, { onClose: vi.fn(), onInsert: vi.fn() })),
	);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	vi.useRealTimers();
});
async function enter(text: string) {
	const input = document.querySelector<HTMLTextAreaElement>("#diagram-input")!;
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}
async function settle() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
}
function insertButton() {
	return [...document.querySelectorAll("button")].find(
		(button) => button.textContent === "Insert into draft",
	)!;
}
it("debounces rough input, rejects stale previews and permits an identical replacement result", async () => {
	await enter("customers have orders");
	expect(rpc.convert).not.toHaveBeenCalled();
	await settle();
	expect(rpc.convert).toHaveBeenCalledTimes(1);
	expect(insertButton().disabled).toBe(false);
	await enter("customers have orders, preserve their labels");
	expect(insertButton().disabled).toBe(true);
	await settle();
	expect(rpc.convert).toHaveBeenCalledTimes(2);
	expect(insertButton().disabled).toBe(false);
});
it("keeps failures visible and pauses automatic retries", async () => {
	rpc.convert.mockRejectedValue(new Error("Sign in from your terminal"));
	await enter("customer has orders");
	await settle();
	expect(document.querySelector('[role="alert"]')?.textContent).toContain(
		"Sign in from your terminal",
	);
	expect(insertButton().disabled).toBe(true);
	await settle();
	expect(rpc.convert).toHaveBeenCalledTimes(1);
});
it("ignores an old response after the input changes", async () => {
	let complete!: (value: typeof result) => void;
	rpc.convert.mockReturnValueOnce(
		new Promise((resolve) => {
			complete = resolve;
		}),
	);
	await enter("old description");
	await settle();
	await enter("new description");
	await act(async () => complete(result));
	expect(insertButton().disabled).toBe(true);
	expect(document.querySelector("[data-preview]")).toBe(null);
	expect(rpc.cancel).toHaveBeenCalled();
	await settle();
	expect(insertButton().disabled).toBe(false);
});
it("waits a full second after the latest edit", async () => {
	await enter("customers");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(999);
	});
	expect(rpc.convert).not.toHaveBeenCalled();
	await enter("customers have orders");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(999);
	});
	expect(rpc.convert).not.toHaveBeenCalled();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
	expect(rpc.convert).toHaveBeenCalledTimes(1);
});
it.each(["shortcut", "blur", "button"])(
	"flushes immediately on %s without a duplicate conversion",
	async (trigger) => {
		await enter("customers have orders");
		const textarea = document.querySelector<HTMLTextAreaElement>("#diagram-input")!;
		await act(async () => {
			if (trigger === "shortcut")
				textarea.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
				);
			if (trigger === "blur") textarea.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
			if (trigger === "button")
				document.querySelector<HTMLButtonElement>('[aria-label="Convert now"]')!.click();
		});
		expect(rpc.convert).toHaveBeenCalledTimes(1);
		await act(async () => textarea.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
		await settle();
		expect(rpc.convert).toHaveBeenCalledTimes(1);
	},
);
it("explicitly retries failures with a newer revision", async () => {
	rpc.convert.mockRejectedValueOnce(new Error("Unavailable"));
	await enter("customers have orders");
	await settle();
	await act(async () =>
		document.querySelector<HTMLButtonElement>('[aria-label="Convert now"]')!.click(),
	);
	expect(rpc.convert).toHaveBeenCalledTimes(2);
	expect(rpc.convert.mock.calls[1][0].revision).toBeGreaterThan(
		rpc.convert.mock.calls[0][0].revision,
	);
	expect(insertButton().disabled).toBe(false);
});
it("keeps generated source on the left while the diagram stays visible on the right", async () => {
	await enter("customers have orders");
	await settle();
	await act(async () =>
		[...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
			.find((button) => button.textContent === "Mermaid")!
			.click(),
	);
	expect(
		document.querySelector('[aria-label="Diagram source"] textarea')?.getAttribute("aria-label"),
	).toBe("Generated Mermaid");
	expect(document.querySelector('[aria-label="Diagram preview"] [data-preview]')?.textContent).toBe(
		result.mermaid,
	);
	expect(document.querySelector("select")).toBe(null);
});
it("opens an existing diagram with its source and only converts after it is edited", async () => {
	const onInsert = vi.fn();
	await act(async () =>
		root.render(
			createElement(MermaidDialog, {
				key: "existing",
				initialSource: result.mermaid,
				onClose: vi.fn(),
				onInsert,
			}),
		),
	);
	expect(document.querySelector<HTMLTextAreaElement>("#diagram-input")!.value).toBe(result.mermaid);
	await settle();
	expect(rpc.convert).not.toHaveBeenCalled();
	const update = [...document.querySelectorAll("button")].find(
		(button) => button.textContent === "Update in draft",
	)!;
	expect(update.disabled).toBe(false);
	await enter(result.mermaid + "\nPlease add products to orders");
	expect(update.disabled).toBe(true);
	await settle();
	expect(rpc.convert).toHaveBeenCalledTimes(1);
	await act(async () => update.click());
	expect(onInsert).toHaveBeenCalledWith(result.mermaid);
});
