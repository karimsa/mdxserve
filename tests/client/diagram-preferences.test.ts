// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiagramPreferences } from "../../client/diagrams/Preferences";
const rpc = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), save: vi.fn() }));
vi.mock("../../client/api", () => ({
	trpcClient: {
		getDiagramPreferences: { query: rpc.get },
		listDiagramModels: { mutate: rpc.list },
		setDiagramPreferences: { mutate: rpc.save },
	},
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
	vi.clearAllMocks();
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
	await act(async () =>
		[...document.querySelectorAll("button")]
			.find((button) => button.textContent === "Save settings")!
			.click(),
	);
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
