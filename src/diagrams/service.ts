import { randomUUID } from "node:crypto";
import type { PreferencesService, DiagramAgent, DiagramModels } from "../preferences/service.js";
import {
	draftSchema,
	type AgentPort,
	type AgentModel,
	type AgentStatus,
	type DiagramDraft,
	type ImagePort,
	type Provider,
	type ValidationPort,
} from "./types.js";
import { diagramPolicyError } from "./policy.js";

export type Failure =
	| { kind: "error"; message: string }
	| { kind: "disabled" | "forbidden" | "cancelled" | "busy"; message: string };
export type Outcome<Value> = { kind: "ok"; value: Value } | Failure;
interface Session {
	revision: number;
	abort?: AbortController;
	touched: number;
}
interface Upload {
	session: string;
	parts: Buffer[];
	size: number;
	next: number;
	ready?: Buffer;
	normalizing?: boolean;
	touched: number;
}
export class DiagramsService {
	private readonly sessions = new Map<string, Session>();
	private readonly uploads = new Map<string, Upload>();
	private tail: Promise<unknown> = Promise.resolve();
	private pending = 0;
	private discovering = false;
	private discoveryAbort?: AbortController;
	constructor(
		private readonly preferences: PreferencesService,
		private readonly agents: AgentPort,
		private readonly validate: ValidationPort,
		private readonly normalize: ImagePort,
	) {}
	private access(allowed: boolean): Failure | null {
		if (!allowed)
			return {
				kind: "forbidden",
				message: "Diagram conversion requires a same-machine connection",
			};
		const settings = this.preferences.read();
		if (settings.kind === "error") return settings;
		if (settings.agent === "disabled")
			return {
				kind: "disabled",
				message: "Diagram conversion is disabled. Enable it in Preferences or mdxserve setup.",
			};
		return null;
	}
	private prune() {
		const cutoff = Date.now() - 10 * 60 * 1000;
		for (const [key, session] of this.sessions)
			if (session.touched < cutoff && !session.abort) this.sessions.delete(key);
		for (const [key, upload] of this.uploads) if (upload.touched < cutoff) this.uploads.delete(key);
	}
	private activeSessionCount() {
		let count = 0;
		for (const session of this.sessions.values())
			if (session.revision !== Number.MAX_SAFE_INTEGER) count++;
		return count;
	}
	/** Called on configuration change and shutdown, including external setup changes. */
	stopIfDisabled() {
		const settings = this.preferences.read();
		if (settings.kind === "error" || settings.agent === "disabled") this.stopConversions();
		else this.prune();
	}
	dispose() {
		this.discoveryAbort?.abort();
		this.stopConversions();
	}
	private stopConversions() {
		for (const session of this.sessions.values()) session.abort?.abort();
		this.uploads.clear();
	}
	getPreferences(allowed: boolean) {
		if (!allowed) return { kind: "forbidden" as const, message: "Local access required" };
		return this.preferences.read();
	}
	setPreferences(agent: DiagramAgent, allowed: boolean, models?: DiagramModels) {
		if (!allowed) return { kind: "forbidden" as const, message: "Local access required" };
		const result = this.preferences.set(agent, models);
		if (result.kind === "ok" && agent === "disabled") this.dispose();
		return result;
	}
	async listModels(provider: Provider, allowed: boolean): Promise<Outcome<AgentModel[]>> {
		if (!allowed) return { kind: "forbidden", message: "Local access required" };
		if (provider !== "codex" && provider !== "claude")
			return { kind: "error", message: "Unknown diagram agent" };
		if (this.discovering) return { kind: "busy", message: "Agent discovery is already running" };
		this.discovering = true;
		this.discoveryAbort = new AbortController();
		try {
			return { kind: "ok", value: await this.agents.models(provider, this.discoveryAbort.signal) };
		} catch {
			return {
				kind: "error",
				message:
					"Could not load models from the CLI. Your saved model is unchanged. Retry after checking the CLI installation.",
			};
		} finally {
			this.discovering = false;
			this.discoveryAbort = undefined;
		}
	}
	async probe(allowed: boolean): Promise<Outcome<AgentStatus[]>> {
		if (!allowed) return { kind: "forbidden", message: "Local access required" };
		if (this.discovering) return { kind: "busy", message: "Agent discovery is already running" };
		this.discovering = true;
		this.discoveryAbort = new AbortController();
		try {
			return { kind: "ok", value: await this.agents.probe(this.discoveryAbort.signal) };
		} catch {
			return { kind: "error", message: "Could not check local agents" };
		} finally {
			this.discovering = false;
			this.discoveryAbort = undefined;
		}
	}
	cancel(sessionId: string, revision: number, allowed: boolean): Outcome<null> {
		if (!allowed) return { kind: "forbidden", message: "Local access required" };
		this.prune();
		const previous = this.sessions.get(sessionId);
		if (previous && revision >= previous.revision) {
			previous.abort?.abort();
			previous.revision = revision;
			previous.touched = Date.now();
		} else if (!previous && this.activeSessionCount() < 100)
			this.sessions.set(sessionId, { revision, touched: Date.now() });
		return { kind: "ok", value: null };
	}
	release(session: string, allowed: boolean): Outcome<null> {
		if (!allowed) return { kind: "forbidden", message: "Local access required" };
		this.cancel(session, Number.MAX_SAFE_INTEGER, allowed);
		for (const [key, upload] of this.uploads)
			if (upload.session === session) this.uploads.delete(key);
		return { kind: "ok", value: null };
	}
	discardUpload(session: string, key: string, allowed: boolean): Outcome<null> {
		if (!allowed) return { kind: "forbidden", message: "Local access required" };
		if (this.uploads.get(key)?.session === session) this.uploads.delete(key);
		return { kind: "ok", value: null };
	}
	beginUpload(session: string, allowed: boolean): Outcome<string> {
		const denied = this.access(allowed);
		if (denied) return denied;
		this.prune();
		if (this.sessions.get(session)?.revision === Number.MAX_SAFE_INTEGER)
			return { kind: "cancelled", message: "Dialog closed" };
		if (this.uploads.size >= 4)
			return { kind: "busy", message: "Too many image uploads; close another diagram dialog" };
		const key = randomUUID();
		this.uploads.set(key, { session, parts: [], size: 0, next: 0, touched: Date.now() });
		return { kind: "ok", value: key };
	}
	appendUpload(
		session: string,
		key: string,
		sequence: number,
		data: string,
		allowed: boolean,
	): Outcome<number> {
		const denied = this.access(allowed);
		if (denied) return denied;
		const upload = this.uploads.get(key);
		if (
			!upload ||
			upload.session !== session ||
			upload.ready ||
			upload.normalizing ||
			sequence !== upload.next
		)
			return { kind: "error", message: "Image upload expired or arrived out of order" };
		if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
			return { kind: "error", message: "Invalid image encoding" };
		const bytes = Buffer.from(data, "base64");
		if (
			bytes.length === 0 ||
			bytes.length > 128 * 1024 ||
			upload.size + bytes.length > 10 * 1024 * 1024
		) {
			this.uploads.delete(key);
			return { kind: "error", message: "Image exceeds the 10 MiB limit" };
		}
		upload.parts.push(bytes);
		upload.size += bytes.length;
		upload.next++;
		upload.touched = Date.now();
		return { kind: "ok", value: upload.next };
	}
	async finishUpload(session: string, key: string, allowed: boolean): Promise<Outcome<string>> {
		const denied = this.access(allowed);
		if (denied) return denied;
		const upload = this.uploads.get(key);
		if (!upload || upload.session !== session || !upload.size || upload.normalizing || upload.ready)
			return { kind: "error", message: "Image upload is missing" };
		upload.normalizing = true;
		try {
			const normalized = await this.normalize(Buffer.concat(upload.parts));
			if (!normalized.length || normalized.length > 10 * 1024 * 1024)
				throw new Error("Normalized image exceeds the 10 MiB limit");
			const invalid = this.access(allowed);
			if (invalid) return invalid;
			if (this.uploads.get(key) !== upload)
				return { kind: "cancelled", message: "Image upload cancelled" };
			upload.ready = normalized;
			upload.parts = [];
			upload.touched = Date.now();
			return { kind: "ok", value: key };
		} catch {
			this.uploads.delete(key);
			return {
				kind: "error",
				message: "Use a valid PNG, JPEG or WebP, at most 10 MiB and 25 megapixels",
			};
		}
	}
	async convert(
		input: {
			session: string;
			revision: number;
			text: string;
			imageId?: string;
		},
		allowed: boolean,
	): Promise<Outcome<DiagramDraft & { provider: Provider }>> {
		const denied = this.access(allowed);
		if (denied) return denied;
		this.prune();
		if (!input.text.trim() && !input.imageId)
			return { kind: "error", message: "Add text or an image" };
		if (input.text.length > 16000) return { kind: "error", message: "Diagram input is too long" };
		const previous = this.sessions.get(input.session);
		if (previous && input.revision <= previous.revision)
			return { kind: "cancelled", message: "Superseded conversion" };
		if (this.pending >= 4 || (!previous && this.activeSessionCount() >= 100))
			return { kind: "busy", message: "Diagram conversion is busy; retry shortly" };
		previous?.abort?.abort();
		const abort = new AbortController();
		let deadline: ReturnType<typeof setTimeout> | undefined;
		const session: Session = { revision: input.revision, abort, touched: Date.now() };
		this.sessions.set(input.session, session);
		this.pending++;
		const work = this.tail.then(
			async (): Promise<Outcome<DiagramDraft & { provider: Provider }>> => {
				if (abort.signal.aborted) return { kind: "cancelled", message: "Conversion cancelled" };
				const unavailable = this.access(allowed);
				if (unavailable) return unavailable;
				let image: Buffer | undefined;
				if (input.imageId) {
					const upload = this.uploads.get(input.imageId);
					if (!upload?.ready || upload.session !== input.session)
						return { kind: "error", message: "Upload the image again" };
					image = upload.ready;
					upload.touched = Date.now();
				}
				const settings = this.preferences.read();
				if (settings.kind !== "ok") return settings;
				if (settings.agent === "disabled")
					return { kind: "disabled", message: "Diagram conversion disabled" };
				deadline = setTimeout(() => abort.abort(), 95000);
				const provider = settings.agent;
				const model = settings.models[provider];
				try {
					let draft = draftSchema.parse(
						await this.agents.convert(provider, { text: input.text, image, model }, abort.signal),
					);
					let error =
						diagramPolicyError(draft.mermaid) ?? (await this.validate(draft.mermaid, abort.signal));
					if (error && !abort.signal.aborted) {
						draft = draftSchema.parse(
							await this.agents.convert(
								provider,
								{
									text:
										input.text +
										"\n\nRepair this draft without changing its meaning:\n" +
										draft.mermaid +
										"\nValidator: " +
										error,
									image,
									model,
								},
								abort.signal,
							),
						);
						error =
							diagramPolicyError(draft.mermaid) ??
							(await this.validate(draft.mermaid, abort.signal));
					}
					if (abort.signal.aborted) return { kind: "cancelled", message: "Conversion cancelled" };
					const deniedNow = this.access(allowed);
					if (deniedNow) return deniedNow;
					if (error)
						return {
							kind: "error",
							message:
								"Could not produce valid Mermaid. Clarify the input and retry. " +
								error.slice(0, 500),
						};
					return { kind: "ok", value: { ...draft, provider } };
				} catch (error) {
					return abort.signal.aborted
						? { kind: "cancelled", message: "Conversion cancelled" }
						: {
								kind: "error",
								message: error instanceof Error ? error.message : "Conversion failed",
							};
				}
			},
		);
		this.tail = work.catch(() => undefined);
		try {
			return await work;
		} finally {
			clearTimeout(deadline);
			this.pending--;
			if (this.sessions.get(input.session) === session) {
				session.abort = undefined;
				session.touched = Date.now();
			}
		}
	}
}
