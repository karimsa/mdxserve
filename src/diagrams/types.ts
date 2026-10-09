import { z } from "zod";
export type Provider = "codex" | "claude";
export const draftSchema = z
	.object({
		mermaid: z.string().min(1).max(65536),
		assumptions: z.array(z.string().max(1000)).max(20),
		changes: z.array(z.string().max(1000)).max(20),
	})
	.strict();
export type DiagramDraft = z.infer<typeof draftSchema>;
export type AgentStatus = {
	provider: Provider;
	state: "ready" | "missing" | "signed-out" | "unsupported" | "error";
};
export type DiagramInput = { text: string; image?: Buffer; model: string };
export type AgentModel = { id: string; label: string };
export interface AgentPort {
	models(provider: Provider, signal?: AbortSignal): Promise<AgentModel[]>;
	probe(signal?: AbortSignal): Promise<AgentStatus[]>;
	convert(provider: Provider, input: DiagramInput, signal: AbortSignal): Promise<DiagramDraft>;
}
export type ValidationPort = (source: string, signal: AbortSignal) => Promise<string | null>;
export type ImagePort = (bytes: Buffer) => Promise<Buffer>;
