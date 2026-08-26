import type { inferRouterOutputs } from "@trpc/server";
// Type-only: client/ may only import types from src/ (see client/api.ts).
import type { AppRouter } from "../src/api/router";
import type { ExportFormat } from "../src/export/service";
import { trpcClient } from "./api";
import { formatSize } from "./format";
import { pushToast } from "./ui/Toast";
import {
	canUseSavePicker,
	decodeContents,
	downloadViaAnchor,
	gestureStillActive,
	pickSaveFile,
	writeToHandle,
} from "./export-save";

type ExportDocResult = inferRouterOutputs<AppRouter>["exportDoc"];

type Picked = { kind: "picked"; handle: FileSystemFileHandle | null } | { kind: "expired" };

/**
 * The viewer's Export flow: build on the server, then hand the bytes to the
 * browser. The native save picker needs a live user gesture, and Chrome
 * expires one about 5 s after the click — so it is only tried when the build
 * finished inside that window; otherwise (and on Firefox/Safari, which have
 * no picker) the file goes out as an ordinary download. Never picker-before-
 * build: the picker truncates an existing file the moment it is chosen, and
 * a failed build would leave that file empty.
 */
export async function exportDocFromViewer(input: {
	path: string;
	format: ExportFormat;
}): Promise<void> {
	let result: ExportDocResult;
	try {
		result = await trpcClient.exportDoc.mutate({ path: input.path, format: input.format });
	} catch (error) {
		console.error(error);
		pushToast({ tone: "danger", text: "Export failed" });
		return;
	}

	const blob = decodeContents(result.contents, result.encoding);
	try {
		if (canUseSavePicker() && gestureStillActive()) {
			const picked: Picked = await pickSaveFile(result.fileName, input.format).then(
				(handle) => ({ kind: "picked", handle }),
				// SecurityError: the gesture expired between the check and the
				// call. A plain download needs no gesture.
				() => ({ kind: "expired" }),
			);
			if (picked.kind === "picked") {
				// The reader closed the picker: nothing was saved, nothing to say.
				if (!picked.handle) return;
				await writeToHandle(picked.handle, blob);
			} else {
				downloadViaAnchor(result.fileName, blob);
			}
		} else {
			downloadViaAnchor(result.fileName, blob);
		}
	} catch (error) {
		console.error(error);
		pushToast({ tone: "danger", text: "Couldn't save the file" });
		return;
	}

	pushToast({
		tone: "ok",
		icon: "download",
		text: `Exported ${result.fileName} · ${formatSize(result.bytes)}`,
	});
	if (result.warnings.length > 0) {
		console.warn(result.warnings.join("\n"));
		pushToast({
			tone: "warn",
			text: `${result.warnings.length} export warning${result.warnings.length === 1 ? "" : "s"}`,
		});
	}
}
