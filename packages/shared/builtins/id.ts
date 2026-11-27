import { z } from "zod";

/** What an authored `id` must look like: a letter, then letters, digits, `-` and `_`. */
export const AUTHORED_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * The `id` prop every stateful builtin takes. The document parser checks the
 * pattern and uniqueness itself (`missing-id`, `invalid-id`, `duplicate-id`),
 * so the schema only says it is a string.
 */
export const statefulIdProp = z
	.string()
	.describe(
		"Required stable ID, unique within this document: a letter, then letters, digits, - or _. Keep it across edits so the reader's state for this block survives.",
	);
