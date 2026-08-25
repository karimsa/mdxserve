import { z } from "zod";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { procedure, requireLoopback } from "../api/trpc.js";

// A root added/removed at runtime is named by the caller (the CLI, or a
// future settings UI), not resolved against some server-side cwd the way
// `serve`'s startup roots are — so the schema requires an absolute path
// outright rather than accepting a relative one to resolve later.
const absolutePath = z
	.string()
	.min(1)
	.max(4096)
	.refine((value) => path.isAbsolute(value), { message: "must be an absolute path" });

export const rootInfoSchema = z.object({ name: z.string(), dir: z.string() });

export const listRootsResultSchema = z.object({ roots: z.array(rootInfoSchema) });

export const addRootsInput = z.object({ dirs: z.array(absolutePath).min(1).max(50) });
export const addRootsResultSchema = z.object({
	added: z.array(z.string()),
	roots: z.array(rootInfoSchema),
});

export const removeRootsInput = z.object({ dirs: z.array(absolutePath).min(1).max(50) });
export const removeRootsResultSchema = z.object({
	removed: z.array(z.string()),
	roots: z.array(rootInfoSchema),
});

const listRoots = procedure(
	"Returns every currently mounted root, in mount order, with its display name. Used by the CLI's `roots list` command and the MCP `list_roots` tool.",
)
	.output(listRootsResultSchema)
	.query(({ ctx }) => {
		return { roots: ctx.rootInfos };
	});

const addRoots = procedure(
	"Mounts one or more absolute directories onto the live server, applying the change immediately (Vite's fs.allow, its watcher, and the generated app.css). Same-machine callers only. Used by the CLI's `roots add` command.",
)
	.use(requireLoopback)
	.input(addRootsInput)
	.output(addRootsResultSchema)
	.mutation(async ({ ctx, input }) => {
		const result = await ctx.roots.add(input.dirs);
		switch (result.kind) {
			case "ok":
				return { added: result.added, roots: result.roots };
			case "not-found":
				throw new TRPCError({ code: "NOT_FOUND", message: result.message });
			case "not-a-directory":
				throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
			case "refused":
				throw new TRPCError({ code: "FORBIDDEN", message: result.message });
			case "nested":
				throw new TRPCError({ code: "CONFLICT", message: result.message });
			default: {
				const exhaustiveResult: never = result;
				throw new Error(`Unhandled add result: ${JSON.stringify(exhaustiveResult)}`);
			}
		}
	});

const removeRoots = procedure(
	"Unmounts one or more currently-served directories from the live server, applying the change immediately. Same-machine callers only. Used by the CLI's `roots remove` command.",
)
	.use(requireLoopback)
	.input(removeRootsInput)
	.output(removeRootsResultSchema)
	.mutation(async ({ ctx, input }) => {
		const result = await ctx.roots.remove(input.dirs);
		switch (result.kind) {
			case "ok":
				return { removed: result.removed, roots: result.roots };
			case "not-mounted":
				throw new TRPCError({ code: "NOT_FOUND", message: result.message });
			default: {
				const exhaustiveResult: never = result;
				throw new Error(`Unhandled remove result: ${JSON.stringify(exhaustiveResult)}`);
			}
		}
	});

export const rootsController = { listRoots, addRoots, removeRoots };

export type ListRootsOutput = z.infer<typeof listRootsResultSchema>;
export type AddRootsInput = z.infer<typeof addRootsInput>;
export type AddRootsOutput = z.infer<typeof addRootsResultSchema>;
export type RemoveRootsInput = z.infer<typeof removeRootsInput>;
export type RemoveRootsOutput = z.infer<typeof removeRootsResultSchema>;
