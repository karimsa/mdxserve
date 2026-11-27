// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Badge from "@mdxserve/ui/builtins/Badge";
import Callout from "@mdxserve/ui/builtins/Callout";
import Tabs from "@mdxserve/ui/builtins/Tabs";

// The shared builtins (@mdxserve/ui) as the browser gets them: React Native components
// through react-native-web, with the elements the web client rendered before they moved.

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});

function draw(element: ReactElement) {
	act(() => root.render(element));
}

describe("Badge", () => {
	it("stays phrasing content, so it may sit in a paragraph", () => {
		draw(
			<p>
				Status:{" "}
				<Badge tone="ok" variant="soft" dot={true}>
					Online
				</Badge>
			</p>,
		);
		const badge = host.querySelector("p > span")!;
		expect(badge.textContent).toBe("Online");
		expect(badge.className).toContain("bg-status-ok-bg");
		expect(host.querySelector("p div")).toBeNull();
		expect(badge.querySelector('[aria-hidden="true"]')!.className).toContain("rounded-full");
	});
});

describe("Callout", () => {
	it("titles the box with a paragraph, defaulting to the tone's label", () => {
		draw(
			<Callout tone="warn">
				<p>Body</p>
			</Callout>,
		);
		const title = host.querySelector("p.font-bold")!;
		expect(title.textContent).toBe("Careful");
		expect(title.className).toContain("text-status-warn-fg");
		expect(host.querySelector('svg[data-icon="triangle-alert"]')).not.toBeNull();
		expect(host.textContent).toContain("Body");
	});
});

describe("Tabs", () => {
	const tabs = [
		{ id: "os>mac", value: "mac", label: "macOS", content: <p>Use brew.</p> },
		{
			id: "os>linux",
			value: "linux",
			label: "Linux",
			content: <p>Use apt.</p>,
		},
	];

	it("renders an ARIA tab list over panels that all stay mounted", () => {
		draw(<Tabs id="os" tabs={tabs} selected="mac" onSelect={() => {}} />);
		const [mac, linux] = host.querySelectorAll<HTMLElement>('[role="tablist"] > [role="tab"]');
		expect(mac.getAttribute("aria-selected")).toBe("true");
		expect(mac.getAttribute("aria-controls")).toBe("os>mac");
		expect(mac.tabIndex).toBe(0);
		expect(linux.tabIndex).toBe(-1);

		const panel = host.querySelector<HTMLElement>('[id="os>linux"]')!;
		expect(panel.getAttribute("role")).toBe("tabpanel");
		expect(panel.getAttribute("aria-labelledby")).toBe("os>linux~tab");
		expect(panel.dataset).toMatchObject({ tabPanel: "", tabsId: "os", tabValue: "linux" });
		expect(panel.classList.contains("hidden")).toBe(true);
		expect(panel.textContent).toBe("Use apt.");
		expect(host.querySelector('[data-tabs="os"]')).not.toBeNull();
	});

	it("moves the selection with the arrow keys", () => {
		const onSelect = vi.fn();
		draw(<Tabs id="os" tabs={tabs} selected="mac" onSelect={onSelect} />);
		const list = host.querySelector('[role="tablist"]')!;
		act(() => {
			list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
		});
		expect(onSelect).toHaveBeenCalledWith("linux");
	});

	it("selects a tab that is clicked", () => {
		const onSelect = vi.fn();
		draw(<Tabs id="os" tabs={tabs} selected="mac" onSelect={onSelect} />);
		act(() => host.querySelectorAll<HTMLElement>('[role="tab"]')[1].click());
		expect(onSelect).toHaveBeenCalledWith("linux");
	});
});
