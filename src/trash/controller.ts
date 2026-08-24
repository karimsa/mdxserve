import { z } from "zod";
import { procedure } from "../api/trpc.js";
import { TrashService } from "./service.js";

export const moveDocsToTrashInput = z.object({
	paths: z.array(z.string().min(1)).min(1).max(500),
});

export const moveDocsToTrashResultSchema = z.object({
	deleted: z.array(z.string()),
	failed: z.array(z.object({ path: z.string(), error: z.string() })),
});

const moveDocsToTrash = procedure(
	"Moves the given doc files (never directories) to the OS Trash, so they are recoverable. Used by the folder view's multi-select delete; returns which paths were trashed and which failed, with a reason each.",
)
	.input(moveDocsToTrashInput)
	.output(moveDocsToTrashResultSchema)
	.mutation(({ ctx, input }) => new TrashService(ctx.rootInfos).moveToTrash(input.paths));

export const trashController = { moveDocsToTrash };

export type MoveDocsToTrashInput = z.infer<typeof moveDocsToTrashInput>;
export type MoveDocsToTrashResult = z.infer<typeof moveDocsToTrashResultSchema>;
