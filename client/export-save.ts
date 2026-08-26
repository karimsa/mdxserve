/**
 * Pure(ish) helpers behind the Export dialog's save flow (client/ui/ExportDialog.tsx).
 * Nothing here touches `window`/`document`/`navigator` at module scope, so this
 * module stays importable under node — the file-name/encoding logic is unit
 * tested the same way client/mermaid-direction.ts is.
 */

/**
 * `/a/b/guide.md` -> `guide.html`; handles `\` separators, a case-insensitive
 * `.md`/`.mdx` source extension, and a stray trailing `.<extension>` (so
 * re-running this on its own previous output — e.g. re-exporting the same
 * doc — never doubles the extension).
 */
export function exportFileName(docPath: string, extension: string): string {
	const lastSegment = docPath.split(/[/\\]/).pop() ?? docPath;
	const targetExtensionPattern = extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const stem = lastSegment
		.replace(/\.mdx?$/i, "")
		.replace(new RegExp(`\\.${targetExtensionPattern}$`, "i"), "");
	return `${stem}.${extension}`;
}

const MIME_TYPES: Record<string, string> = {
	html: "text/html",
};

/** "html" -> "text/html"; any other extension falls back to a generic binary type. */
export function mimeFor(extension: string): string {
	return MIME_TYPES[extension] ?? "application/octet-stream";
}

/** Decodes `exportDoc`'s wire contents (utf8 text or base64 bytes) into a Blob. */
export function decodeContents(contents: string, encoding: "utf8" | "base64"): Blob {
	if (encoding === "utf8") return new Blob([contents], { type: "text/plain" });
	const binary = atob(contents);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return new Blob([bytes]);
}

/** Whether the browser exposes the File System Access save-picker API. */
export function canUseSavePicker(): boolean {
	return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

/** Whether a user gesture (click) is still active — the picker requires one. */
export function gestureStillActive(): boolean {
	return navigator.userActivation?.isActive ?? false;
}

/**
 * Opens the native save-file picker; resolves `null` when the user cancels
 * (the picker rejects with `AbortError`). Must be called while a user gesture
 * is still active, or the browser rejects with a `SecurityError`.
 */
export async function pickSaveFile(
	suggestedName: string,
	extension: string,
): Promise<FileSystemFileHandle | null> {
	if (!window.showSaveFilePicker) return null;
	try {
		return await window.showSaveFilePicker({
			suggestedName,
			types: [
				{
					description: extension.toUpperCase(),
					accept: { [mimeFor(extension)]: [`.${extension}`] },
				},
			],
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") return null;
		throw error;
	}
}

/** Writes `blob` to a handle from `pickSaveFile` and closes the stream. */
export async function writeToHandle(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
	const writable = await handle.createWritable();
	await writable.write(blob);
	await writable.close();
}

/** Firefox/Safari fallback: a hidden `<a download>` click, then revoke the object URL. */
export function downloadViaAnchor(fileName: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	// Revoke after the click has been dispatched; some browsers start the
	// download asynchronously and would find the URL already gone.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
