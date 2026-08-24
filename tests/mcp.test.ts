import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
	createMcpServer,
	type DocTreeRoot,
	type McpContext,
	type RemoteDocs,
	type RemoteOutcome,
} from "../src/mcp.js";
import type { RenderOutcome } from "../src/render.js";
import type { SearchResult } from "../src/search.js";
import type { ValidationResult } from "../src/validate.js";
import { fixtureRegistry as registry } from "./fixtures/registry.js";

let fixtureDir: string;
let otherDir: string;

async function connectedClient(
	getRoots: () => { name: string; dir: string }[] = () => [
		{ name: "docs", dir: fixtureDir },
		{ name: "other", dir: otherDir },
	],
	extra: Partial<McpContext> = {},
) {
	const server = createMcpServer({ getRoots, registry, ...extra });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test-client", version: "0.0.0" });
	await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
	return { client, server };
}

beforeAll(async () => {
	fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-mcp-test-"));
	await fs.writeFile(
		path.join(fixtureDir, "good.md"),
		"# Good doc\n\nSome plain GFM content about widgets and gadgets.\n",
		"utf8",
	);
	// "Calout" is the classic one-letter typo of "Callout": not a prefix or
	// substring match, so it only surfaces via suggest()'s edit-distance fallback.
	await fs.writeFile(
		path.join(fixtureDir, "bad.mdx"),
		'# Bad doc\n\n<Calout tone="warn">hi</Calout>\n\n<Callout tonee="x">y</Callout>\n',
		"utf8",
	);
	await fs.writeFile(
		path.join(fixtureDir, "warn.mdx"),
		'# Warn\n\n<Callout tonee="x">y</Callout>\n',
		"utf8",
	);
	await fs.mkdir(path.join(fixtureDir, "sub"));
	await fs.writeFile(
		path.join(fixtureDir, "sub", "nested.md"),
		"# Nested\n\nNested content.\n",
		"utf8",
	);
	// A second root that shares a filename with the first, so a bare
	// "good.md" is ambiguous while "sub/nested.md" is not.
	otherDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-mcp-other-"));
	await fs.symlink(otherDir, path.join(fixtureDir, "escape"), "dir");
	await fs.writeFile(path.join(otherDir, "good.md"), "# Other\n\nOther root.\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
	await fs.rm(otherDir, { recursive: true, force: true });
});

describe("createMcpServer", () => {
	it("lists exactly the five tools", async () => {
		const { client, server } = await connectedClient();
		try {
			const { tools } = await client.listTools();
			expect(tools.map((t) => t.name).sort()).toEqual(
				["list_components", "list_docs", "search_docs", "show_component", "validate_doc"].sort(),
			);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("validate_doc reports ok for a clean doc given by absolute path", async () => {
		const { client, server } = await connectedClient();
		try {
			const abs = path.join(fixtureDir, "good.md");
			const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toMatchObject({ ok: true, path: abs });
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("validate_doc accepts a root-relative path when exactly one root has it", async () => {
		const { client, server } = await connectedClient();
		try {
			const result = await client.callTool({
				name: "validate_doc",
				arguments: { path: "sub/nested.md" },
			});
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toMatchObject({
				ok: true,
				path: path.join(fixtureDir, "sub", "nested.md"),
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("validate_doc lists warnings in its text even when ok", async () => {
		const { client, server } = await connectedClient();
		try {
			const abs = path.join(fixtureDir, "warn.mdx");
			const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toMatchObject({ ok: true });
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toMatch(/^OK with 1 warning:/);
			expect(text).toContain("unknown-prop");
			expect(text).toContain("tonee");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("validate_doc rejects a root-relative path that exists in several roots", async () => {
		const { client, server } = await connectedClient();
		try {
			const result = await client.callTool({
				name: "validate_doc",
				arguments: { path: "good.md" },
			});
			expect(result.isError).toBe(true);
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain(path.join(fixtureDir, "good.md"));
			expect(text).toContain(path.join(otherDir, "good.md"));
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("validate_doc reports diagnostics for an mdx doc with mistakes", async () => {
		const { client, server } = await connectedClient();
		try {
			const result = await client.callTool({
				name: "validate_doc",
				arguments: { path: "bad.mdx" },
			});
			expect(result.isError).toBeFalsy();
			const structured = result.structuredContent as {
				ok: boolean;
				diagnostics: Array<{
					code: string;
					component?: string;
					prop?: string;
					suggestions?: string[];
				}>;
			};
			expect(structured.ok).toBe(false);

			const unknownComponent = structured.diagnostics.find((d) => d.code === "unknown-component");
			expect(unknownComponent?.component).toBe("Calout");
			expect(unknownComponent?.suggestions).toContain("Callout");

			const unknownProp = structured.diagnostics.find((d) => d.code === "unknown-prop");
			expect(unknownProp?.prop).toBe("tonee");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("validate_doc rejects paths outside every root", async () => {
		const { client, server } = await connectedClient();
		try {
			for (const p of ["../etc/passwd", "/etc/passwd", path.join(fixtureDir, "..", "x.md")]) {
				const result = await client.callTool({ name: "validate_doc", arguments: { path: p } });
				expect(result.isError).toBe(true);
			}
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("validate_doc rejects a directory path", async () => {
		const { client, server } = await connectedClient();
		try {
			const result = await client.callTool({ name: "validate_doc", arguments: { path: "sub" } });
			expect(result.isError).toBe(true);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("show_component finds a component case-insensitively", async () => {
		const { client, server } = await connectedClient();
		try {
			const result = await client.callTool({
				name: "show_component",
				arguments: { name: "callout" },
			});
			expect(result.isError).toBeFalsy();
			const structured = result.structuredContent as { component: { name: string } };
			expect(structured.component.name).toBe("Callout");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("show_component errors for an unknown component", async () => {
		const { client, server } = await connectedClient();
		try {
			const result = await client.callTool({ name: "show_component", arguments: { name: "Nope" } });
			expect(result.isError).toBe(true);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("list_components filters by a query", async () => {
		const { client, server } = await connectedClient();
		try {
			const result = await client.callTool({
				name: "list_components",
				arguments: { query: "tone" },
			});
			expect(result.isError).toBeFalsy();
			const structured = result.structuredContent as { components: Array<{ name: string }> };
			const names = structured.components.map((c) => c.name);
			expect(names).toContain("Callout");
			expect(names).toContain("Badge");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("list_docs lists every root by default and one root when given a directory", async () => {
		const { client, server } = await connectedClient();
		try {
			const all = await client.callTool({ name: "list_docs", arguments: {} });
			expect(all.isError).toBeFalsy();
			const allRoots = (
				all.structuredContent as { roots: Array<{ name: string; nodes: unknown[] }> }
			).roots;
			expect(allRoots.map((r) => r.name)).toEqual(["docs", "other"]);
			expect(JSON.stringify(allRoots[0].nodes)).toContain(
				path.join(fixtureDir, "sub", "nested.md"),
			);

			const one = await client.callTool({
				name: "list_docs",
				arguments: { path: path.join(fixtureDir, "sub") },
			});
			const oneRoots = (
				one.structuredContent as { roots: Array<{ name: string; nodes: unknown[] }> }
			).roots;
			expect(oneRoots.map((r) => r.name)).toEqual(["docs"]);
			expect(JSON.stringify(oneRoots[0].nodes)).toContain("nested.md");

			const bad = await client.callTool({ name: "list_docs", arguments: { path: "/nope" } });
			expect(bad.isError).toBe(true);

			// A symlinked directory inside a root that points outside it must not
			// be listable through the tool.
			const escaped = await client.callTool({
				name: "list_docs",
				arguments: { path: path.join(fixtureDir, "escape") },
			});
			expect(escaped.isError).toBe(true);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("search_docs finds a word from good.md", async () => {
		const { client, server } = await connectedClient();
		try {
			const result = await client.callTool({
				name: "search_docs",
				arguments: { query: "widgets" },
			});
			expect(result.isError).toBeFalsy();
			const structured = result.structuredContent as { results: Array<{ path: string }> };
			expect(structured.results.some((r) => r.path.endsWith("good.md"))).toBe(true);
		} finally {
			await client.close();
			await server.close();
		}
	});

	describe("validate_doc render wiring", () => {
		it("reports rendered:false when no render function is configured", async () => {
			const { client, server } = await connectedClient();
			try {
				const abs = path.join(fixtureDir, "good.md");
				const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
				expect(result.isError).toBeFalsy();
				expect(result.structuredContent).toMatchObject({ ok: true, rendered: false });
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("Not rendered (no mdxserve server is running");
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("runs the configured render function and reports a render-error on failure", async () => {
			const render = async (): Promise<RenderOutcome> => ({
				ok: false,
				message: "boom is not defined",
				line: 4,
			});
			const { client, server } = await connectedClient(undefined, { render });
			try {
				const abs = path.join(fixtureDir, "good.md");
				const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
				expect(result.isError).toBeFalsy();
				const structured = result.structuredContent as ValidationResult;
				expect(structured.rendered).toBe(true);
				expect(structured.ok).toBe(false);
				expect(structured.diagnostics).toContainEqual(
					expect.objectContaining({
						code: "render-error",
						message: "boom is not defined",
						line: 4,
					}),
				);
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("Rendered with errors");
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("reports Rendered OK when the render function succeeds", async () => {
			const render = async (): Promise<RenderOutcome> => ({ ok: true });
			const { client, server } = await connectedClient(undefined, { render });
			try {
				const abs = path.join(fixtureDir, "good.md");
				const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
				expect(result.isError).toBeFalsy();
				expect(result.structuredContent).toMatchObject({ ok: true, rendered: true });
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("Rendered OK");
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("returns a remote validate_doc result verbatim, without running local validation", async () => {
			const canned: ValidationResult = {
				ok: false,
				path: "/somewhere/entirely/else.md",
				diagnostics: [
					{ severity: "error", code: "render-error", message: "from the remote server" },
				],
				rendered: true,
			};
			const remote = {
				validateDoc: async (): Promise<ValidationResult | null> => canned,
				searchDocs: async (): Promise<RemoteOutcome<SearchResult[]>> => ({ kind: "unavailable" }),
				listDocs: async (): Promise<RemoteOutcome<DocTreeRoot[]>> => ({ kind: "unavailable" }),
			};
			const { client, server } = await connectedClient(undefined, { remote });
			try {
				const abs = path.join(fixtureDir, "good.md");
				const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
				expect(result.isError).toBeFalsy();
				expect(result.structuredContent).toEqual(canned);
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("from the remote server");
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("falls back to local validation when the remote validateDoc returns null", async () => {
			const remote = {
				validateDoc: async (): Promise<ValidationResult | null> => null,
				searchDocs: async (): Promise<RemoteOutcome<SearchResult[]>> => ({ kind: "unavailable" }),
				listDocs: async (): Promise<RemoteOutcome<DocTreeRoot[]>> => ({ kind: "unavailable" }),
			};
			const { client, server } = await connectedClient(undefined, { remote });
			try {
				const abs = path.join(fixtureDir, "good.md");
				const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
				expect(result.isError).toBeFalsy();
				expect(result.structuredContent).toMatchObject({ ok: true, path: abs, rendered: false });
			} finally {
				await client.close();
				await server.close();
			}
		});
	});

	describe("remote search_docs/list_docs wiring", () => {
		function unavailableRemote(): RemoteDocs {
			return {
				validateDoc: async () => null,
				searchDocs: async () => ({ kind: "unavailable" }),
				listDocs: async () => ({ kind: "unavailable" }),
			};
		}

		it("search_docs prefers a remote ok result over the local index", async () => {
			const canned: SearchResult[] = [
				{
					path: "/remote/only.md",
					label: "remote/only.md",
					title: "Remote only",
					excerpt: "This result only exists on the remote server.",
					terms: ["widgets"],
					score: 5,
				},
			];
			const remote = {
				...unavailableRemote(),
				searchDocs: async (): Promise<RemoteOutcome<SearchResult[]>> => ({
					kind: "ok",
					value: canned,
				}),
			};
			const { client, server } = await connectedClient(undefined, { remote });
			try {
				const result = await client.callTool({
					name: "search_docs",
					arguments: { query: "widgets" },
				});
				expect(result.isError).toBeFalsy();
				expect(result.structuredContent).toEqual({ results: canned });
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("This result only exists on the remote server.");
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("search_docs with a remote error returns isError with the message", async () => {
			const remote = {
				...unavailableRemote(),
				searchDocs: async (): Promise<RemoteOutcome<SearchResult[]>> => ({
					kind: "error",
					message: "the remote server exploded",
				}),
			};
			const { client, server } = await connectedClient(undefined, { remote });
			try {
				const result = await client.callTool({
					name: "search_docs",
					arguments: { query: "widgets" },
				});
				expect(result.isError).toBe(true);
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("the remote server exploded");
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("search_docs falls back to the local index when the remote is unavailable", async () => {
			const { client, server } = await connectedClient(undefined, { remote: unavailableRemote() });
			try {
				const result = await client.callTool({
					name: "search_docs",
					arguments: { query: "widgets" },
				});
				expect(result.isError).toBeFalsy();
				const structured = result.structuredContent as { results: Array<{ path: string }> };
				expect(structured.results.some((hit) => hit.path.endsWith("good.md"))).toBe(true);
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("list_docs prefers a remote ok result over the local walk", async () => {
			const canned: DocTreeRoot[] = [{ name: "remote-root", dir: "/remote/root", nodes: [] }];
			const remote = {
				...unavailableRemote(),
				listDocs: async (): Promise<RemoteOutcome<DocTreeRoot[]>> => ({
					kind: "ok",
					value: canned,
				}),
			};
			const { client, server } = await connectedClient(undefined, { remote });
			try {
				const result = await client.callTool({ name: "list_docs", arguments: {} });
				expect(result.isError).toBeFalsy();
				expect(result.structuredContent).toEqual({ roots: canned });
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("remote-root");
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("list_docs with a remote error returns isError with the message", async () => {
			const remote = {
				...unavailableRemote(),
				listDocs: async (): Promise<RemoteOutcome<DocTreeRoot[]>> => ({
					kind: "error",
					message: "the remote directory does not exist",
				}),
			};
			const { client, server } = await connectedClient(undefined, { remote });
			try {
				const result = await client.callTool({ name: "list_docs", arguments: {} });
				expect(result.isError).toBe(true);
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("the remote directory does not exist");
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("list_docs falls back to the local walk when the remote is unavailable", async () => {
			const { client, server } = await connectedClient(undefined, { remote: unavailableRemote() });
			try {
				const result = await client.callTool({ name: "list_docs", arguments: {} });
				expect(result.isError).toBeFalsy();
				const structured = result.structuredContent as {
					roots: Array<{ name: string; nodes: unknown[] }>;
				};
				expect(structured.roots.map((rootEntry) => rootEntry.name)).toEqual(["docs", "other"]);
			} finally {
				await client.close();
				await server.close();
			}
		});
	});

	describe("with no server running (getRoots returns [])", () => {
		it("validate_doc still validates an absolute path", async () => {
			const { client, server } = await connectedClient(() => []);
			try {
				const abs = path.join(fixtureDir, "good.md");
				const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
				expect(result.isError).toBeFalsy();
				expect(result.structuredContent).toMatchObject({ ok: true, path: abs });
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("validate_doc rejects a relative path, mentioning an absolute path", async () => {
			const { client, server } = await connectedClient(() => []);
			try {
				const result = await client.callTool({
					name: "validate_doc",
					arguments: { path: "good.md" },
				});
				expect(result.isError).toBe(true);
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("mdxserve serve");
				expect(text).toContain("absolute path");
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("search_docs errors, mentioning how to start a server", async () => {
			const { client, server } = await connectedClient(() => []);
			try {
				const result = await client.callTool({
					name: "search_docs",
					arguments: { query: "widgets" },
				});
				expect(result.isError).toBe(true);
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("mdxserve serve");
			} finally {
				await client.close();
				await server.close();
			}
		});

		it("list_docs errors, mentioning how to start a server", async () => {
			const { client, server } = await connectedClient(() => []);
			try {
				const result = await client.callTool({ name: "list_docs", arguments: {} });
				expect(result.isError).toBe(true);
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("mdxserve serve");
			} finally {
				await client.close();
				await server.close();
			}
		});
	});
});
