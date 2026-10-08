import { z } from "zod";
import { useBlockState } from "../block-state/useBlockState";
import type { BlockStateScope } from "../block-state/storage";
import { emptyState, type Column } from "./model";
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

function legacyTableKeys(scope: BlockStateScope): string[] {
	return [`mdxserve:table:v1:${scope.documentPath}:${scope.blockId}`];
}

export function useTableState(scope: BlockStateScope, columns: Column[], persist = true) {
	return useBlockState(scope, {
		persist,
		schema: savedStateSchema,
		initialState: emptyState,
		normalize: (state) => normalizeTableState(state, columns),
		legacyKeys: legacyTableKeys,
	});
}
