import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type McpContext } from "../src/mcp.js";
import { handleRequest, type RequestContext } from "../src/server.js";
import type { RenderOutcome } from "../src/render.js";
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

		it("returns a validateRemote result verbatim, without running local validation", async () => {
			const canned: ValidationResult = {
				ok: false,
				path: "/somewhere/entirely/else.md",
				diagnostics: [
					{ severity: "error", code: "render-error", message: "from the remote server" },
				],
				rendered: true,
			};
			const validateRemote = async (): Promise<ValidationResult | null> => canned;
			const { client, server } = await connectedClient(undefined, { validateRemote });
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

		it("falls back to local validation when validateRemote returns null", async () => {
			const validateRemote = async (): Promise<ValidationResult | null> => null;
			const { client, server } = await connectedClient(undefined, { validateRemote });
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

describe("POST /__mdxserve/api/validate", () => {
	function makeCtx(overrides: Partial<RequestContext> = {}): RequestContext {
		return {
			roots: [fixtureDir],
			rootInfos: [{ name: "docs", dir: fixtureDir }],
			pkgRoot: "",
			vite: {} as unknown as ViteDevServer,
			cssFile: "",
			mcp: { getRoots: () => [{ name: "docs", dir: fixtureDir }], registry },
			...overrides,
		};
	}

	async function startTestServer(ctx: RequestContext) {
		const server = http.createServer((req, res) => {
			handleRequest(req, res, ctx).catch((error) => {
				if (!res.headersSent) res.statusCode = 500;
				res.end(String(error));
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		return { server, base: `http://127.0.0.1:${port}` };
	}

	it("405s a non-POST request", async () => {
		const { server, base } = await startTestServer(makeCtx());
		try {
			const res = await fetch(`${base}/__mdxserve/api/validate`, { method: "GET" });
			expect(res.status).toBe(405);
			expect(res.headers.get("allow")).toBe("POST");
		} finally {
			server.close();
		}
	});

	it("415s a non-JSON content type", async () => {
		const { server, base } = await startTestServer(makeCtx());
		try {
			const res = await fetch(`${base}/__mdxserve/api/validate`, {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: JSON.stringify({ path: path.join(fixtureDir, "good.md") }),
			});
			expect(res.status).toBe(415);
		} finally {
			server.close();
		}
	});

	it("413s an oversized body", async () => {
		const { server, base } = await startTestServer(makeCtx());
		try {
			const res = await fetch(`${base}/__mdxserve/api/validate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: "x".repeat(8 * 1024) }),
			});
			expect(res.status).toBe(413);
		} finally {
			server.close();
		}
	});

	it("400s an invalid body", async () => {
		const { server, base } = await startTestServer(makeCtx());
		try {
			const res = await fetch(`${base}/__mdxserve/api/validate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ nope: true }),
			});
			expect(res.status).toBe(400);
		} finally {
			server.close();
		}
	});

	it("404s a path outside every root", async () => {
		const { server, base } = await startTestServer(makeCtx());
		try {
			const res = await fetch(`${base}/__mdxserve/api/validate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: "/etc/passwd" }),
			});
			expect(res.status).toBe(404);
		} finally {
			server.close();
		}
	});

	it("validates a doc, running the configured render function", async () => {
		const render = async (): Promise<RenderOutcome> => ({ ok: false, message: "boom", line: 2 });
		const { server, base } = await startTestServer(
			makeCtx({ mcp: { getRoots: () => [{ name: "docs", dir: fixtureDir }], registry, render } }),
		);
		try {
			const res = await fetch(`${base}/__mdxserve/api/validate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: path.join(fixtureDir, "good.md") }),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as ValidationResult;
			expect(body.rendered).toBe(true);
			expect(body.ok).toBe(false);
			expect(body.diagnostics).toContainEqual(
				expect.objectContaining({ code: "render-error", message: "boom", line: 2 }),
			);
		} finally {
			server.close();
		}
	});
});
