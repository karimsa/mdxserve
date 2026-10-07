import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedure } from "../api/trpc.js";
import type { TreeNode } from "./tree.js";
import { ListingService } from "./service.js";

const listingEntrySchema = z.object({
	name: z.string(),
	isDir: z.boolean(),
	isDoc: z.boolean(),
	/** Plain-text first h1 of the doc, when it has one. */
	title: z.string().optional(),
	/** The same h1 as inline HTML, for display. */
	titleHtml: z.string().optional(),
	size: z.number().optional(),
	/** Last modified time, epoch milliseconds. */
	mtime: z.number().optional(),
});

export const getFolderListingInput = z.object({ path: z.string() });

// Matches src/listing/folder.ts's FolderListing; the "listing" kind on the
// client-side Route is added separately.
export const folderListingSchema = z.object({
	path: z.string(),
	rootName: z.string(),
	rootDir: z.string(),
	entries: z.array(listingEntrySchema),
});

export const getDocTreeInput = z.object({
	path: z.string().optional(),
	maxDepth: z.number().int().min(1).max(8).default(8),
});

// Recursive schema via zod 4 getter syntax: `children` refers back to
// `treeNodeSchema` itself, so the reference must be lazy.
export const treeNodeSchema: z.ZodType<TreeNode> = z.object({
	name: z.string(),
	/** Absolute filesystem path; directories end in "/". */
	path: z.string(),
	isDir: z.boolean(),
	isDoc: z.boolean(),
	/** Last modified time, epoch milliseconds. */
	mtime: z.number().optional(),
	get children() {
		return z.array(treeNodeSchema).optional();
	},
});

export const docTreeRootSchema = z.object({
	name: z.string(),
	dir: z.string(),
	nodes: z.array(treeNodeSchema),
});

export const docTreeSchema = z.object({
	roots: z.array(docTreeRootSchema),
});

const getFolderListing = procedure(
	"Lists the entries (subfolders and .md/.mdx docs, with titles, sizes, and mtimes) of one folder under a served root. Used by the folder view and the sidebar when a folder is opened or changes on disk.",
)
	.input(getFolderListingInput)
	.output(folderListingSchema)
	.query(async ({ ctx, input }) => {
		const listingService = new ListingService(ctx.rootInfos, ctx.docCache);
		const result = await listingService.folderListing(input.path);
		if (result.kind === "not-found") {
			throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
		}
		return result.listing;
	});

const getDocTree = procedure(
	"Returns the full doc tree of every served root, or of one directory, up to maxDepth levels. Used by the sidebar, ⌘K search, prev/next navigation, and `mdxserve docs`.",
)
	.input(getDocTreeInput)
	.output(docTreeSchema)
	.query(async ({ ctx, input }) => {
		const listingService = new ListingService(ctx.rootInfos, ctx.docCache);
		const result = await listingService.docTree({ path: input.path, maxDepth: input.maxDepth });
		if (result.kind === "not-found") {
			throw new TRPCError({ code: "NOT_FOUND", message: result.message });
		}
		return { roots: result.roots };
	});

export const listingController = { getFolderListing, getDocTree };

export type GetFolderListingInput = z.infer<typeof getFolderListingInput>;
export type FolderListingOutput = z.infer<typeof folderListingSchema>;
export type GetDocTreeInput = z.infer<typeof getDocTreeInput>;
export type DocTree = z.infer<typeof docTreeSchema>;
export type DocTreeRoot = z.infer<typeof docTreeRootSchema>;
