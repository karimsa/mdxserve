import fsp from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { router, procedure } from "./trpc.js";
import {
	getFolderListingInput,
	folderListingSchema,
	getDocTreeInput,
	docTreeSchema,
	searchDocsInput,
	searchDocsResultSchema,
	moveDocsToTrashInput,
	moveDocsToTrashResultSchema,
	validateDocInput,
	validationResultSchema,
	getDocSourceInput,
	docSourceSchema,
	saveDocSectionInput,
	saveDocSectionResultSchema,
} from "./schemas.js";
import { readListing, readTree } from "../listing.js";
import { search } from "../search.js";
import { resolveRoot, resolveDirPath, resolveDocPath } from "../paths.js";
import { rootInfoFor } from "../roots.js";
import { moveDocsToTrash } from "../trash-docs.js";
import { validateDocAt } from "../validate-doc.js";
import { readDocSource, saveDocSection as saveDocSectionOnDisk } from "../doc-source.js";

const getFolderListing = procedure(
	"Lists the entries (subfolders and .md/.mdx docs, with titles, sizes, and mtimes) of one folder under a served root. Used by the folder view and the sidebar when a folder is opened or changes on disk.",
)
	.input(getFolderListingInput)
	.output(folderListingSchema)
	.query(async ({ ctx, input }) => {
		const hit = resolveRoot(ctx.roots, input.path);

		let isDirectory = false;
		if (hit) {
			try {
				isDirectory = (await fsp.stat(hit.abs)).isDirectory();
			} catch {
				isDirectory = false;
			}
		}

		if (!hit || !isDirectory) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
		}

		return readListing(hit.abs, rootInfoFor(ctx.rootInfos, hit.root));
	});

const getDocTree = procedure(
	"Returns the full doc tree of every served root, or of one directory, up to maxDepth levels. Used by the sidebar, ⌘K search, prev/next navigation, and the MCP list_docs tool.",
)
	.input(getDocTreeInput)
	.output(docTreeSchema)
	.query(async ({ ctx, input }) => {
		if (input.path === undefined) {
			return {
				roots: ctx.rootInfos.map((rootInfo) => ({
					name: rootInfo.name,
					dir: rootInfo.dir,
					nodes: readTree(rootInfo.dir, input.maxDepth),
				})),
			};
		}

		const resolved = await resolveDirPath(ctx.roots, input.path);
		if (!resolved.ok) {
			throw new TRPCError({ code: "NOT_FOUND", message: resolved.error });
		}

		const rootInfo = rootInfoFor(ctx.rootInfos, resolved.root);
		return {
			roots: [
				{
					name: rootInfo.name,
					dir: rootInfo.dir,
					nodes: readTree(resolved.abs, input.maxDepth),
				},
			],
		};
	});

const searchDocs = procedure(
	"Full-text search across the titles, headings, and bodies of every served doc, ranked, capped at 30 results. Used by the ⌘K search dialog and the MCP search_docs tool; an empty query returns docs in tree order.",
)
	.input(searchDocsInput)
	.output(searchDocsResultSchema)
	.query(({ ctx, input }) => search(ctx.rootInfos, input.query));

const moveDocsToTrashProcedure = procedure(
	"Moves the given doc files (never directories) to the OS Trash, so they are recoverable. Used by the folder view's multi-select delete; returns which paths were trashed and which failed, with a reason each.",
)
	.input(moveDocsToTrashInput)
	.output(moveDocsToTrashResultSchema)
	.mutation(({ ctx, input }) => moveDocsToTrash(ctx.roots, input.paths));

const validateDoc = procedure(
	"Validates one .md/.mdx file: MDX compile errors, unknown components/props against the builtin registry, and — for same-machine callers only — a server-side render to catch render-time throws. Used by the MCP validate_doc tool.",
)
	.input(validateDocInput)
	.output(validationResultSchema)
	.mutation(async ({ ctx, input }) => {
		const resolved = await resolveDocPath(ctx.roots, input.path);
		if (!resolved.ok) {
			throw new TRPCError({ code: "NOT_FOUND", message: resolved.error });
		}

		return validateDocAt(resolved.abs, {
			registry: ctx.registry,
			render: ctx.isLoopback ? ctx.render : undefined,
		});
	});

const getDocSource = procedure(
	"Returns the raw on-disk text of one .md/.mdx doc together with its mtime, so the in-place section editor can seed itself from exactly what is on disk (not the compiled module) and later detect concurrent edits. Used by the section editor when a section is opened.",
)
	.input(getDocSourceInput)
	.output(docSourceSchema)
	.query(async ({ ctx, input }) => {
		const resolved = await resolveDocPath(ctx.roots, input.path);
		if (!resolved.ok) {
			throw new TRPCError({ code: "NOT_FOUND", message: resolved.error });
		}
		const read = await readDocSource(resolved.abs);
		if (!read.ok) {
			throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "File too large to edit" });
		}
		return read.source;
	});

const saveDocSection = procedure(
	"Replaces one line range of a doc with edited markdown: the mtime must still match the one the caller read (otherwise CONFLICT), the resulting file must validate (otherwise UNPROCESSABLE_CONTENT), and the write is atomic. Used by the in-place section editor's Save.",
)
	.input(saveDocSectionInput)
	.output(saveDocSectionResultSchema)
	.mutation(async ({ ctx, input }) => {
		const resolved = await resolveDocPath(ctx.roots, input.path);
		if (!resolved.ok) {
			throw new TRPCError({ code: "NOT_FOUND", message: resolved.error });
		}
		// Write to the real file, not the path the user navigated to: if
		// `input.path` is a symlink, rename() onto it would replace the link
		// itself with a regular file and leave the target untouched.
		// resolveDocPath already checked the realpath stays inside the root.
		const abs = await fsp.realpath(resolved.abs);

		const result = await saveDocSectionOnDisk({
			abs,
			startLine: input.startLine,
			endLine: input.endLine,
			mtime: input.mtime,
			markdown: input.markdown,
			registry: ctx.registry,
		});
		if (result.ok) return { mtime: result.mtime };
		switch (result.kind) {
			case "stale":
				throw new TRPCError({ code: "CONFLICT", message: "File changed on disk" });
			case "invalid-range":
				throw new TRPCError({ code: "CONFLICT", message: result.error });
			case "invalid-doc":
				throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: result.error });
		}
	});

export const appRouter = router({
	getFolderListing,
	getDocTree,
	searchDocs,
	moveDocsToTrash: moveDocsToTrashProcedure,
	validateDoc,
	getDocSource,
	saveDocSection,
});

export type AppRouter = typeof appRouter;
