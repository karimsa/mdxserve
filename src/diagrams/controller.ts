import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedure, requireLoopback, type ApiContext } from "../api/trpc.js";
import { DIAGRAM_AGENTS, isDiagramModel } from "../preferences/service.js";
import { draftSchema } from "./types.js";
import type { Outcome } from "./service.js";
export const diagramAgentSchema = z.enum(DIAGRAM_AGENTS);
export const diagramModelsSchema = z.object({
	codex: z.string().refine(isDiagramModel),
	claude: z.string().refine(isDiagramModel),
});
export const diagramPreferencesSchema = z.object({
	agent: diagramAgentSchema,
	configured: z.boolean(),
	models: diagramModelsSchema,
});
export const diagramSessionSchema = z.object({ session: z.uuid() });
export const convertDiagramInput = diagramSessionSchema.extend({
	revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	text: z.string().max(16000),
	imageId: z.uuid().optional(),
});
export const diagramDraftSchema = draftSchema.extend({ provider: z.enum(["codex", "claude"]) });
function service(ctx: ApiContext) {
	if (!ctx.diagrams)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Diagram conversion is unavailable",
		});
	return ctx.diagrams;
}
function unwrap<Value>(result: Outcome<Value>): Value {
	if (result.kind === "ok") return result.value;
	throw new TRPCError({
		code:
			result.kind === "forbidden"
				? "FORBIDDEN"
				: result.kind === "busy"
					? "TOO_MANY_REQUESTS"
					: result.kind === "cancelled"
						? "CONFLICT"
						: "BAD_REQUEST",
		message: result.message,
	});
}
export const diagramsController = {
	listDiagramModels: procedure(
		"Read model choices from the selected local CLI without generating content.",
	)
		.use(requireLoopback)
		.input(z.object({ provider: z.enum(["codex", "claude"]) }))
		.output(
			z
				.array(z.object({ id: z.string().refine(isDiagramModel), label: z.string().max(200) }))
				.max(2000),
		)
		.query(async ({ ctx, input }) =>
			unwrap(await service(ctx).listModels(input.provider, ctx.isLoopback)),
		),
	discardDiagramImage: procedure("Discard a temporary image owned by this dialog.")
		.use(requireLoopback)
		.input(diagramSessionSchema.extend({ imageId: z.uuid() }))
		.output(z.null())
		.mutation(({ ctx, input }) =>
			unwrap(service(ctx).discardUpload(input.session, input.imageId, ctx.isLoopback)),
		),
	getDiagramPreferences: procedure(
		"Read the local diagram agent preference; Disabled hides creation controls.",
	)
		.use(requireLoopback)
		.input(z.object({}))
		.output(diagramPreferencesSchema)
		.query(({ ctx }) => {
			const result = service(ctx).getPreferences(ctx.isLoopback);
			if (result.kind !== "ok")
				throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
			return {
				agent: result.agent,
				configured: result.configured,
				models: result.models,
			};
		}),
	setDiagramPreferences: procedure(
		"Set the default agent or disable diagram conversion, cancelling in-flight work.",
	)
		.use(requireLoopback)
		.input(z.object({ agent: diagramAgentSchema, models: diagramModelsSchema.optional() }))
		.output(diagramPreferencesSchema)
		.mutation(({ ctx, input }) => {
			const result = service(ctx).setPreferences(input.agent, ctx.isLoopback, input.models);
			if (result.kind !== "ok")
				throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
			return {
				agent: result.agent,
				configured: result.configured,
				models: result.models,
			};
		}),
	probeDiagramAgents: procedure(
		"Explicitly recheck installed local agents and authentication without model calls.",
	)
		.use(requireLoopback)
		.input(z.object({}))
		.output(
			z.array(
				z.object({
					provider: z.enum(["codex", "claude"]),
					state: z.enum(["ready", "missing", "signed-out", "unsupported", "error"]),
				}),
			),
		)
		.mutation(async ({ ctx }) => unwrap(await service(ctx).probe(ctx.isLoopback))),
	convertDiagram: procedure(
		"Convert diagram text or a session-owned uploaded image with a non-interactive local agent.",
	)
		.use(requireLoopback)
		.input(convertDiagramInput)
		.output(diagramDraftSchema)
		.mutation(async ({ ctx, input }) => unwrap(await service(ctx).convert(input, ctx.isLoopback))),
	cancelDiagramConversion: procedure(
		"Cancel this dialog revision and reject late requests for that revision.",
	)
		.use(requireLoopback)
		.input(
			diagramSessionSchema.extend({
				revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
			}),
		)
		.output(z.null())
		.mutation(({ ctx, input }) =>
			unwrap(service(ctx).cancel(input.session, input.revision, ctx.isLoopback)),
		),
	releaseDiagramSession: procedure(
		"Close a diagram dialog and release its images and active conversion.",
	)
		.use(requireLoopback)
		.input(diagramSessionSchema)
		.output(z.null())
		.mutation(({ ctx, input }) => unwrap(service(ctx).release(input.session, ctx.isLoopback))),
	beginDiagramImageUpload: procedure("Begin a bounded image upload owned by this diagram dialog.")
		.use(requireLoopback)
		.input(diagramSessionSchema)
		.output(z.uuid())
		.mutation(({ ctx, input }) => unwrap(service(ctx).beginUpload(input.session, ctx.isLoopback))),
	appendDiagramImageChunk: procedure(
		"Append one ordered base64 image chunk without raising the API body limit.",
	)
		.use(requireLoopback)
		.input(
			diagramSessionSchema.extend({
				imageId: z.uuid(),
				sequence: z.number().int().nonnegative(),
				data: z.string().max(175000),
			}),
		)
		.output(z.number().int())
		.mutation(({ ctx, input }) =>
			unwrap(
				service(ctx).appendUpload(
					input.session,
					input.imageId,
					input.sequence,
					input.data,
					ctx.isLoopback,
				),
			),
		),
	finishDiagramImageUpload: procedure(
		"Decode, validate and normalize an uploaded PNG, JPEG or WebP before conversion.",
	)
		.use(requireLoopback)
		.input(diagramSessionSchema.extend({ imageId: z.uuid() }))
		.output(z.uuid())
		.mutation(async ({ ctx, input }) =>
			unwrap(await service(ctx).finishUpload(input.session, input.imageId, ctx.isLoopback)),
		),
};
