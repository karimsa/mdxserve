// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Modal } from "../../client/ui/Modal";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
	// jsdom does not implement the native dialog lifecycle. Browser verification
	// covers focus trapping and native Escape dispatch; these tests cover policy.
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	document.body.style.overflow = "";
});

function outsideClick(dialog: HTMLDialogElement, startOutside = true) {
	vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 20, 400, 300));
	dialog.dispatchEvent(
		new MouseEvent("pointerdown", { bubbles: true, clientX: startOutside ? 0 : 30, clientY: 30 }),
	);
	dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 0, clientY: 30 }));
}

it("blocks native cancellation and backdrop dismissal while pending, then uses the latest callback", async () => {
	const onClose = vi.fn();
	await act(async () =>
		root.render(createElement(Modal, { open: true, dismissible: false, onClose })),
	);
	const dialog = document.querySelector("dialog")!;
	const cancel = new Event("cancel", { cancelable: true });
	await act(async () => {
		dialog.dispatchEvent(cancel);
		outsideClick(dialog);
	});
	expect(cancel.defaultPrevented).toBe(true);
	expect(onClose).not.toHaveBeenCalled();
	const nextClose = vi.fn();
	await act(async () => root.render(createElement(Modal, { open: true, onClose: nextClose })));
	await act(async () => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
	expect(nextClose).toHaveBeenCalledOnce();
	expect(onClose).not.toHaveBeenCalled();
});

it("separates backdrop policy from Escape and ignores drags from inside", async () => {
	const onClose = vi.fn();
	const onBackdropClick = vi.fn();
	await act(async () =>
		root.render(createElement(Modal, { open: true, onClose, onBackdropClick })),
	);
	const dialog = document.querySelector("dialog")!;
	await act(async () => outsideClick(dialog, false));
	expect(onBackdropClick).not.toHaveBeenCalled();
	await act(async () => outsideClick(dialog));
	expect(onBackdropClick).toHaveBeenCalledOnce();
	expect(onClose).not.toHaveBeenCalled();
	await act(async () => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
	expect(onClose).toHaveBeenCalledOnce();
});

it("keeps nested cancellation local and restores scrolling when the whole tree unmounts", async () => {
	const parentClose = vi.fn();
	const childClose = vi.fn();
	document.body.style.overflow = "scroll";
	await act(async () =>
		root.render(
			createElement(
				Modal,
				{ open: true, onClose: parentClose },
				createElement(Modal, { open: true, onClose: childClose }),
			),
		),
	);
	const dialogs = document.querySelectorAll("dialog");
	await act(async () =>
		dialogs[0].dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })),
	);
	// Portals put the child first in DOM order.
	expect(childClose).toHaveBeenCalledOnce();
	expect(parentClose).not.toHaveBeenCalled();
	expect(document.body.style.overflow).toBe("hidden");
	await act(async () => root.render(null));
	expect(document.body.style.overflow).toBe("scroll");
});

it("focuses the requested input and returns focus on unmount", async () => {
	const opener = document.createElement("button");
	document.body.append(opener);
	opener.focus();
	await act(async () =>
		root.render(
			createElement(Modal, { open: true, initialFocus: "input" }, createElement("input")),
		),
	);
	expect(document.activeElement).toBe(document.querySelector("dialog input"));
	await act(async () => root.render(null));
	expect(document.activeElement).toBe(opener);
	opener.remove();
});
