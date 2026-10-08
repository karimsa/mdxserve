import { useEffect, useState } from "react";
import { z } from "zod";
import { emptyState, type Column, type TableState } from "./model";
import { normalizeTableState } from "./table-state";

const savedStateSchema = z.object({
	columnTypes: z
		.record(z.string(), z.enum(["text", "number", "percent", "time", "bytes", "currency"]))
		.optional(),
	sort: z.object({ key: z.string(), descending: z.boolean() }).optional(),
	filters: z.record(
		z.string(),
		z.object({
			pattern: z.string().optional(),
			unit: z.string().optional(),
			min: z.string().optional(),
			max: z.string().optional(),
		}),
	),
	units: z.record(z.string(), z.string()),
});

export function useTableState(storageKey: string, columns: Column[]) {
	const [state, setState] = useState<TableState>(emptyState);
	const [loaded, setLoaded] = useState(false);
	const normalized = normalizeTableState(state, columns);

	useEffect(() => {
		try {
			const saved = savedStateSchema.safeParse(
				JSON.parse(localStorage.getItem(storageKey) ?? "null"),
			);
			if (saved.success) setState(saved.data);
		} catch {
			/* storage is optional */
		}
		setLoaded(true);
	}, [storageKey]);

	useEffect(() => {
		if (loaded) {
			setState(normalized);
			try {
				localStorage.setItem(storageKey, JSON.stringify(normalized));
			} catch {
				/* storage is optional */
			}
		}
	}, [normalized, loaded, storageKey]);

	return [normalized, setState] as const;
}
