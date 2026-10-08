import { useEffect, useState } from "react";
import { z } from "zod";
import { emptyState, type TableState } from "./model";

const savedStateSchema = z.object({
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

export function useTableState(storageKey: string) {
	const [state, setState] = useState<TableState>(emptyState);
	const [loaded, setLoaded] = useState(false);

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
			try {
				localStorage.setItem(storageKey, JSON.stringify(state));
			} catch {
				/* storage is optional */
			}
		}
	}, [state, loaded, storageKey]);

	return [state, setState] as const;
}
