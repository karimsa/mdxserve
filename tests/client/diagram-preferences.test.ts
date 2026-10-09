// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDefaultStore } from "jotai";
import { contentLayoutAtom, tocVisibleAtom } from "../../client/state";
import { DiagramPreferences } from "../../client/diagrams/Preferences";
const rpc = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), save: vi.fn(), probe: vi.fn() }));
vi.mock("../../client/api", () => ({
	trpcClient: {
		getDiagramPreferences: { query: rpc.get },
		listDiagramModels: { mutate: rpc.list },
		setDiagramPreferences: { mutate: rpc.save },
		probeDiagramAgents: { mutate: rpc.probe },
	},
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
	vi.resetAllMocks();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("localStorage", new JSDOM("", { url: "http://localhost" }).window.localStorage);
	getDefaultStore().set(contentLayoutAtom, "flexible");
	getDefaultStore().set(tocVisibleAtom, true);
	rpc.get.mockResolvedValue({ agent: "codex", models: { codex: "gpt-6-luna", claude: "haiku" } });
	rpc.list.mockImplementation(async ({ provider }) =>
		provider === "codex"
			? [
					{ id: "gpt-6-luna", label: "Luna" },
					{ id: "custom", label: "Custom" },
				]
			: [{ id: "haiku", label: "Haiku" }],
	);
	rpc.save.mockResolvedValue({});
	rpc.probe.mockResolvedValue([{ provider: "claude", state: "ready" }]);
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root.render(createElement(DiagramPreferences, { onClose: vi.fn() })));
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});
async function select(selector: string, value: string) {
	await act(async () => {
		const element = document.querySelector<HTMLSelectElement>(selector)!;
		element.value = value;
		element.dispatchEvent(new Event("change", { bubbles: true }));
	});
}
it("shows only the active agent's models and preserves each selection across switches", async () => {
	expect(document.querySelectorAll("#diagram-model")).toHaveLength(1);
	expect(rpc.list).toHaveBeenCalledWith({ provider: "codex" });
	await select("#diagram-model", "custom");
	await select("#diagram-agent", "claude");
	expect(document.querySelector<HTMLSelectElement>("#diagram-model")!.value).toBe("haiku");
	await select("#diagram-agent", "codex");
	expect(document.querySelector<HTMLSelectElement>("#diagram-model")!.value).toBe("custom");

	expect(rpc.save).toHaveBeenCalledWith({
		agent: "codex",
		models: { codex: "custom", claude: "haiku" },
	});
	await select("#diagram-agent", "disabled");
	expect(document.querySelector("#diagram-model")).toBeNull();
});
it("keeps the saved model when discovery fails", async () => {
	rpc.list.mockRejectedValue(new Error("missing CLI"));
	await select("#diagram-agent", "claude");
	expect(document.querySelector<HTMLSelectElement>("#diagram-model")!.value).toBe("haiku");
	expect(document.body.textContent).toContain("Your saved choice is unchanged");
});

async function clickButton(label: string) {
	await act(async () => {
		[...document.querySelectorAll("button")]
			.find((button) => button.textContent?.trim() === label)!
			.click();
	});
}
it("autosaves agent and model changes without closing Settings or writing during load", async () => {
	expect(rpc.save).not.toHaveBeenCalled();
	expect(document.body.textContent).not.toContain("Save settings");
	await select("#diagram-model", "custom");
	expect(rpc.save).toHaveBeenLastCalledWith({
		agent: "codex",
		models: { codex: "custom", claude: "haiku" },
	});
	await select("#diagram-agent", "disabled");
	expect(rpc.save).toHaveBeenLastCalledWith({
		agent: "disabled",
		models: { codex: "custom", claude: "haiku" },
	});
	expect(document.querySelector("dialog")!.open).toBe(true);
});
it("saves the auto-detected agent without a separate save action", async () => {
	await clickButton("Auto detect");
	expect(rpc.save).toHaveBeenLastCalledWith({
		agent: "claude",
		models: { codex: "gpt-6-luna", claude: "haiku" },
	});
	expect(document.querySelector<HTMLSelectElement>("#diagram-agent")!.value).toBe("claude");
});
it("prevents overlapping writes and restores the saved selection after a failure", async () => {
	let rejectSave!: (failure: Error) => void;
	rpc.save.mockImplementationOnce(
		() =>
			new Promise((_, reject) => {
				rejectSave = reject;
			}),
	);
	await select("#diagram-model", "custom");
	expect(document.body.textContent).toContain("Saving…");
	expect(document.querySelector<HTMLSelectElement>("#diagram-agent")!.disabled).toBe(true);
	expect(document.querySelector<HTMLSelectElement>("#diagram-model")!.disabled).toBe(true);
	await act(async () => rejectSave(new Error("offline")));
	expect(document.querySelector<HTMLSelectElement>("#diagram-model")!.value).toBe("gpt-6-luna");
	expect(document.querySelector('[role="alert"]')!.textContent).toContain("Couldn’t save settings");
	await select("#diagram-model", "custom");
	expect(document.querySelector('[role="alert"]')).toBeNull();
	expect(document.querySelector<HTMLSelectElement>("#diagram-model")!.value).toBe("custom");
});
it("applies layout changes immediately and keeps them across reopening, independently of diagram writes", async () => {
	await clickButton("Layout");
	await select("#content-layout", "full-width");
	expect(getDefaultStore().get(contentLayoutAtom)).toBe("full-width");
	expect(localStorage.getItem("mdxserve.content.layout")).toBe('"full-width"');
	expect(rpc.save).not.toHaveBeenCalled();
	await act(async () => root.render(null));
	await act(async () => root.render(createElement(DiagramPreferences, { onClose: vi.fn() })));
	await clickButton("Layout");
	expect(document.querySelector<HTMLSelectElement>("#content-layout")!.value).toBe("full-width");
});

it("defaults to visible contents and autosaves visibility independently of diagram settings", async () => {
	await clickButton("Layout");
	expect(document.querySelector<HTMLSelectElement>("#toc-visibility")!.value).toBe("visible");
	await select("#toc-visibility", "hidden");
	expect(getDefaultStore().get(tocVisibleAtom)).toBe(false);
	expect(localStorage.getItem("mdxserve.toc.visible")).toBe("false");
	expect(rpc.save).not.toHaveBeenCalled();
	await act(async () => root.render(null));
	await act(async () => root.render(createElement(DiagramPreferences, { onClose: vi.fn() })));
	await clickButton("Layout");
	expect(document.querySelector<HTMLSelectElement>("#toc-visibility")!.value).toBe("hidden");
	await select("#toc-visibility", "visible");
	expect(getDefaultStore().get(tocVisibleAtom)).toBe(true);
	expect(localStorage.getItem("mdxserve.toc.visible")).toBe("true");
});

it("keeps the modal open through every dismissal path until an autosave failure is shown", async () => {
	const onClose = vi.fn();
	await act(async () => root.render(createElement(DiagramPreferences, { onClose })));
	let rejectSave!: (failure: Error) => void;
	rpc.save.mockImplementationOnce(
		() =>
			new Promise((_, reject) => {
				rejectSave = reject;
			}),
	);
	await select("#diagram-model", "custom");
	const dialog = document.querySelector("dialog")!;
	vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 20, 400, 300));
	await act(async () => {
		dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
		dialog.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }));
		dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 0, clientY: 0 }));
		document.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!.click();
	});
	expect(onClose).not.toHaveBeenCalled();
	expect(document.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!.disabled).toBe(
		true,
	);
	await act(async () => rejectSave(new Error("offline")));
	expect(document.querySelector('[role="alert"]')!.textContent).toContain("Couldn’t save settings");
	await act(async () =>
		document.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!.click(),
	);
	expect(onClose).toHaveBeenCalledOnce();
});
it("offers browser-local layout settings to remote viewers without accessing diagram preferences", async () => {
	await act(async () => root.render(null));
	vi.clearAllMocks();
	await act(async () =>
		root.render(createElement(DiagramPreferences, { onClose: vi.fn(), canEditDiagrams: false })),
	);
	expect(document.querySelector("#content-layout")).not.toBeNull();
	expect(document.querySelector("#diagram-agent")).toBeNull();
	expect(
		[...document.querySelectorAll("button")].some(
			(button) => button.textContent?.trim() === "Diagrams",
		),
	).toBe(false);
	await select("#content-layout", "full-width");
	await select("#toc-visibility", "hidden");
	expect(localStorage.getItem("mdxserve.content.layout")).toBe('"full-width"');
	expect(localStorage.getItem("mdxserve.toc.visible")).toBe("false");
	expect(rpc.get).not.toHaveBeenCalled();
	expect(rpc.list).not.toHaveBeenCalled();
	expect(rpc.save).not.toHaveBeenCalled();
	expect(document.body.textContent).not.toContain("Loading settings");
});
