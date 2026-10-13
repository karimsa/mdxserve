import { describe, expect, it } from "vitest";
import { renderShell } from "../../src/http/shell.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ViteDevServer } from "vite";
import { makeRequestContext, startTestServer } from "../helpers/http.js";
import { fixtureRegistry } from "../fixtures/registry.js";
import { MAX_SOURCE_BYTES } from "../../src/docs/service.js";

describe("initial metadata HTML", () => {
	it("escapes declarations, preserves order, and emits one title", () => {
		const html = renderShell(
			{ kind: "doc", path: "/docs/a.md", rootName: "docs", rootDir: "/docs" },
			undefined,
			1,
			false,
			"restricted",
			{
				title: "A <title>",
				description: 'A "description" & more',
				canonical: "https://example.com/?a=1&b=2",
				openGraph: [
					{ property: "og:image", content: "https://example.com/1.jpg" },
					{ property: "og:image", content: "https://example.com/2.jpg" },
				],
			},
		);
		expect(html.split("</head>")[0].match(/<title>/g)).toHaveLength(1);
		expect(html).toContain("<title>A &lt;title&gt;</title>");
		expect(html).toContain('content="A &quot;description&quot; &amp; more"');
		expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
		expect(html.indexOf("1.jpg")).toBeLessThan(html.indexOf("2.jpg"));
		expect(html).toContain('data-mdxserve-metadata property="og:image"');
		expect(html).toContain('"metadata":');
	});
});

describe("document response metadata", () => {
	it("serves metadata from a document above the editor source limit", async () => {
		const root = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-large-metadata-")),
		);
		const doc = path.join(root, "large.md");
		await fs.writeFile(doc, `---\ntitle: A large page\n---\n${"x".repeat(MAX_SOURCE_BYTES)}`);
		const vite = {
			transformIndexHtml: async (_url: string, html: string) => html,
		} as unknown as ViteDevServer;
		const context = makeRequestContext(root, fixtureRegistry, { permissions: "restricted", vite });
		const { server, base } = await startTestServer(context);
		try {
			const response = await fetch(`${base}${encodeURI(doc)}`, {
				headers: { Accept: "text/html" },
			});
			expect(response.status).toBe(200);
			expect(await response.text()).toContain("<title>A large page</title>");
		} finally {
			server.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it.each(["md", "mdx"])(
		"serves metadata in restricted initial HTML without executing .%s imports",
		async (extension) => {
			const root = await fs.realpath(
				await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-metadata-")),
			);
			const doc = path.join(root, `page.${extension}`);
			await fs.writeFile(
				doc,
				`---\ntitle: Public title\nopenGraph:\n  - property: og:site_name\n    content: Example\n---\nimport "./would-execute.js"\n# Body`,
			);
			let moduleRequests = 0;
			const vite = {
				transformIndexHtml: async (_url: string, html: string) => html,
				transformRequest: async () => {
					moduleRequests++;
					return null;
				},
			} as unknown as ViteDevServer;
			const context = makeRequestContext(root, fixtureRegistry, {
				permissions: "restricted",
				vite,
			});
			const { server, base } = await startTestServer(context);
			try {
				const response = await fetch(`${base}${encodeURI(doc)}`, {
					headers: { Accept: "text/html" },
				});
				const html = await response.text();
				expect(response.status).toBe(200);
				expect(html).toContain("<title>Public title</title>");
				expect(html).toContain('property="og:site_name" content="Example"');
				expect(html).toContain('"metadata":');
				expect(moduleRequests).toBe(0);
			} finally {
				server.close();
				await fs.rm(root, { recursive: true, force: true });
			}
		},
	);
});
