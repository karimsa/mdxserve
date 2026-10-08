import { useMemo, useRef, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpcClient } from "../api";
import { MermaidDialog } from "./Dialog";
import { locateDiagram } from "./source";
import type { ExistingDiagram } from "./edit-context";

export function DiagramEditDialog({
	source,
	target,
	path,
	version,
	startLine,
	endLine,
	onClose,
}: {
	source: string;
	target: ExistingDiagram;
	path: string;
	version: string;
	startLine: number;
	endLine: number;
	onClose: () => void;
}) {
	const diagram = useMemo(() => locateDiagram(source, target), [source, target]);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const inFlight = useRef(false);
	async function save(mermaid: string) {
		if (!diagram || inFlight.current) return;
		inFlight.current = true;
		setSaving(true);
		setError("");
		try {
			await trpcClient.saveDocSection.mutate({
				path,
				version,
				startLine,
				endLine,
				markdown: diagram.replace(mermaid),
			});
			onClose();
		} catch (failure) {
			setError(
				isTRPCClientError(failure) && failure.data?.code === "CONFLICT"
					? "File changed on disk. Copy your changes, then close and reopen the diagram."
					: "Couldn't save the diagram. Your changes are still here; try again.",
			);
		} finally {
			inFlight.current = false;
			setSaving(false);
		}
	}
	return (
		<MermaidDialog
			initialSource={diagram?.source ?? target.source}
			onClose={() => {
				if (!inFlight.current) onClose();
			}}
			onInsert={save}
			directSave
			saving={saving}
			saveError={diagram ? error : "Diagram changed on disk. Close and reopen it before editing."}
			saveDisabled={!diagram}
		/>
	);
}
