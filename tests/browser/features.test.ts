import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const START_TIMEOUT_MS = 180_000;

let fixtureDir: string;
let serverHome: string;
let server: ChildProcessWithoutNullStreams;
let base: string;
let browser: Browser;

async function waitForServer(child: ChildProcessWithoutNullStreams): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		let output = "";
		const timeout = setTimeout(
			() => reject(new Error(`server did not start: ${output}`)),
			START_TIMEOUT_MS,
		);
		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString();
			const match = output.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
			if (match) {
				clearTimeout(timeout);
				resolve(`http://127.0.0.1:${match[1]}`);
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.once("exit", (code) => {
			clearTimeout(timeout);
			reject(new Error(`server exited ${code}: ${output}`));
		});
	});
}

async function openPage(): Promise<{ context: BrowserContext; page: Page }> {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await context.newPage();
	return { context, page };
}

function docUrl(name: string): string {
	return `${base}${encodeURI(path.join(fixtureDir, name))}`;
}

function runCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}): string {
	return execFileSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
		cwd: repoRoot,
		env: {
			...process.env,
			MDXSERVE_HOME: serverHome,
			MDXSERVE_CACHE_HOME: path.join(serverHome, "cache"),
			...extraEnv,
		},
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 120_000,
	});
}

beforeAll(async () => {
	fixtureDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-browser-")));
	serverHome = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-browser-home-"));
	await fs.writeFile(
		path.join(fixtureDir, "alpha.md"),
		"# Alpha\n\nFirst section.\n\n## Details\n\nMore text.\n",
	);
	await fs.writeFile(
		path.join(fixtureDir, "beta.mdx"),
		"# Beta\n\nSearchable constellation text.\n",
	);
	await fs.writeFile(path.join(fixtureDir, "notes.txt"), "Not a document.\n");
	await fs.writeFile(
		path.join(fixtureDir, "rich.mdx"),
		[
			"# Rich document",
			"",
			"| Name | Value |",
			"| --- | --- |",
			"| Visible row | 42 |",
			"",
			"<Tabs>",
			'<Tab label="First">First panel</Tab>',
			'<Tab label="Second">Second panel</Tab>',
			"</Tabs>",
			"",
			'<Callout tone="tip">Useful note</Callout>',
			"",
		].join("\n"),
	);
	await fs.writeFile(
		path.join(fixtureDir, "Custom.jsx"),
		"export default function Custom() { return <strong>Neighbor component works</strong>; }\n",
	);
	await fs.writeFile(
		path.join(fixtureDir, "Attribute.jsx"),
		"export default function Attribute({ title }) { return <strong>{title}</strong>; }\n",
	);
	for (const extension of ["md", "mdx"]) {
		await fs.writeFile(
			path.join(fixtureDir, `custom.${extension}`),
			'import Custom from "./Custom.jsx";\n\n# Custom page\n\n<Custom />\n',
		);
		await fs.writeFile(
			path.join(fixtureDir, `expression.${extension}`),
			"export const values = [1, 2]\n\n# Expression page\n\n{values.filter(\n  (value) => value < 10\n).map((value) => <span key={value}>Match {value}</span>)}\n\nWidth < 10\n",
		);
		await fs.writeFile(
			path.join(fixtureDir, `literal-comparison.${extension}`),
			"export let count = 2\nexport const value = '}'\nexport const ok = true\n\n# Literal comparison\n\n{ /}/.test(value) && count < 10 ? 'Expression works' : 'Expression failed' }\n\n{count++ / 2 < 10 ? 'Division works' : 'Division failed'}\n\n{(() => { if (ok) /}/.test(value); return count < 10 })() ? 'Control regex works' : 'Control regex failed'}\n\nUnmatched ` marker\n\n```text\n`\n```\n\nWidth < 10\n",
		);
		await fs.writeFile(
			path.join(fixtureDir, `attribute.${extension}`),
			'import Attribute from "./Attribute.jsx";\n\n# Attribute page\n\n<Attribute title="width < 10" />\n',
		);
		await fs.writeFile(
			path.join(fixtureDir, `escaped-backtick.${extension}`),
			"# Escaped backtick\n\nEscaped \\` marker\n\nWidth < 10\n\nclosing ` marker\n",
		);
		await fs.writeFile(
			path.join(fixtureDir, `esm-comparison.${extension}`),
			"export const small = 1 < 10\n\n# ESM comparison\n\n{small ? 'ESM works' : 'ESM failed'}\n\nWidth < 10\n",
		);
		await fs.writeFile(
			path.join(fixtureDir, `fence-content.${extension}`),
			"# Fence content\n\n```text\n```not-a-closer\nWidth < 10\n```\n\nOutside < 10\n",
		);
	}
	await fs.writeFile(path.join(fixtureDir, "UPPERCASE.MDX"), "# Uppercase page\n\nWidth < 10\n");
	await fs.writeFile(
		path.join(fixtureDir, "metadata.md"),
		"---\ntitle: Markdown metadata\ndescription: First description\ncanonical: https://example.com/first\nopenGraph:\n  - property: og:title\n    content: First share title\n---\n# First metadata page\n\n[Next metadata](./metadata.mdx)\n",
	);
	await fs.writeFile(
		path.join(fixtureDir, "metadata.mdx"),
		"---\ntitle: MDX metadata\ndescription: Second description\ncanonical: https://example.com/second\nopenGraph:\n  - property: og:title\n    content: Second share title\n---\n# Second metadata page\n",
	);
	await fs.mkdir(path.join(fixtureDir, "nested"));
	await fs.writeFile(path.join(fixtureDir, "nested", "gamma.md"), "# Gamma\n\nNested page.\n");

	if (!fsSync.existsSync(path.join(repoRoot, "dist", "registry.json"))) {
		execFileSync(process.execPath, ["--import", "tsx", "scripts/build-registry.ts"], {
			cwd: repoRoot,
			stdio: "pipe",
		});
	}
	server = spawn(
		process.execPath,
		["--import", "tsx", "src/index.ts", "serve", "-p", "0", "-w", fixtureDir],
		{
			cwd: repoRoot,
			env: {
				...process.env,
				MDXSERVE_HOME: serverHome,
				MDXSERVE_CACHE_HOME: path.join(serverHome, "cache"),
			},
		},
	);
	base = await waitForServer(server);
	browser = await chromium.launch({
		headless: true,
		channel: process.env.PLAYWRIGHT_CHROME_CHANNEL || undefined,
	});
}, START_TIMEOUT_MS);

afterAll(async () => {
	await browser?.close();
	if (server && server.exitCode === null) {
		server.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			server.once("exit", () => resolve());
			setTimeout(resolve, 5_000).unref();
		});
	}
	if (fixtureDir) await fs.rm(fixtureDir, { recursive: true, force: true });
	if (serverHome) await fs.rm(serverHome, { recursive: true, force: true });
}, 30_000);

describe("browser feature journeys", () => {
	it("serves and updates frontmatter metadata across Markdown extensions", async () => {
		const initialResponse = await fetch(docUrl("metadata.md"), {
			headers: { Accept: "text/html" },
		});
		expect(initialResponse.status).toBe(200);
		expect(await initialResponse.text()).toContain("<title>Markdown metadata</title>");
		const { context, page } = await openPage();
		try {
			await page.goto(docUrl("metadata.md"));
			await page.getByRole("heading", { name: "First metadata page" }).waitFor();
			expect(await page.title()).toBe("Markdown metadata");
			expect(await page.locator('meta[name="description"]').getAttribute("content")).toBe(
				"First description",
			);
			await page
				.getByRole("link", { name: /Second metadata page/ })
				.first()
				.click();
			await page.getByRole("heading", { name: "Second metadata page" }).waitFor();
			expect(await page.title()).toBe("MDX metadata");
			expect(await page.locator('meta[name="description"]').getAttribute("content")).toBe(
				"Second description",
			);
			expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe(
				"https://example.com/second",
			);
			expect(await page.locator('meta[property="og:title"]').allTextContents()).toHaveLength(1);
		} finally {
			await context.close();
		}
	}, 90_000);

	it("renders a neighboring component from both Markdown extensions", async () => {
		const { context, page } = await openPage();
		try {
			for (const extension of ["md", "mdx"]) {
				await page.goto(docUrl(`custom.${extension}`));
				await page.getByRole("heading", { name: "Custom page" }).waitFor();
				await page.getByText("Neighbor component works").waitFor();
			}
		} finally {
			await context.close();
		}
	}, 90_000);

	it("renders multiline comparisons in MDX expressions from both Markdown extensions", async () => {
		const { context, page } = await openPage();
		try {
			for (const extension of ["md", "mdx"]) {
				await page.goto(docUrl(`expression.${extension}`));
				await page.getByRole("heading", { name: "Expression page" }).waitFor();
				await page.getByText("Match 1").waitFor();
				await page.getByText("Match 2").waitFor();
				await page.getByText("Width < 10").waitFor();
			}
		} finally {
			await context.close();
		}
	}, 90_000);

	it("renders expressions and prose around unmatched or escaped backticks in both extensions", async () => {
		const { context, page } = await openPage();
		try {
			for (const extension of ["md", "mdx"]) {
				await page.goto(docUrl(`literal-comparison.${extension}`));
				await page.getByRole("heading", { name: "Literal comparison" }).waitFor();
				await page.getByText("Expression works").waitFor();
				await page.getByText("Division works").waitFor();
				await page.getByText("Control regex works").waitFor();
				await page.getByText("Width < 10").waitFor();
				await page.goto(docUrl(`escaped-backtick.${extension}`));
				await page.getByRole("heading", { name: "Escaped backtick" }).waitFor();
				await page.getByText("Width < 10").waitFor();
			}
		} finally {
			await context.close();
		}
	}, 90_000);

	it("keeps JSX attribute text and uppercase document rendering consistent", async () => {
		const { context, page } = await openPage();
		try {
			for (const extension of ["md", "mdx"]) {
				await page.goto(docUrl(`attribute.${extension}`));
				await page.getByRole("heading", { name: "Attribute page" }).waitFor();
				await page.getByText("width < 10", { exact: true }).waitFor();
			}
			await page.goto(docUrl("UPPERCASE.MDX"));
			await page.getByRole("heading", { name: "Uppercase page" }).waitFor();
			await page.getByText("Width < 10").waitFor();
		} finally {
			await context.close();
		}
	}, 90_000);

	it("renders ESM comparisons and code fences consistently in both extensions", async () => {
		const { context, page } = await openPage();
		try {
			for (const extension of ["md", "mdx"]) {
				await page.goto(docUrl(`esm-comparison.${extension}`));
				await page.getByRole("heading", { name: "ESM comparison" }).waitFor();
				await page.getByText("ESM works").waitFor();
				await page.getByText("Width < 10").waitFor();
				await page.goto(docUrl(`fence-content.${extension}`));
				await page.getByRole("heading", { name: "Fence content" }).waitFor();
				await page.locator("pre").filter({ hasText: "Width < 10" }).waitFor();
				await page.getByText("Outside < 10").waitFor();
			}
		} finally {
			await context.close();
		}
	}, 90_000);

	it("updates mounted roots in an open viewer and leaves removed documents", async () => {
		const otherRoot = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-browser-second-root-")),
		);
		await fs.writeFile(path.join(otherRoot, "other.md"), "# Other root page\n");
		const { context, page } = await openPage();
		try {
			runCli(["roots", "add", otherRoot]);
			await page.goto(`${base}/`);
			await page.getByRole("link", { name: new RegExp(path.basename(otherRoot)) }).waitFor();
			await page.goto(docUrl("alpha.md"));
			await page.getByRole("heading", { name: "Alpha" }).waitFor();
			runCli(["roots", "remove", fixtureDir]);
			await page.waitForURL((url) => !url.pathname.endsWith("alpha.md"), { timeout: 15_000 });
			await page.getByRole("link", { name: /Other root page/ }).waitFor();
		} finally {
			runCli(["roots", "add", fixtureDir]);
			runCli(["roots", "remove", otherRoot]);
			await context.close();
			await fs.rm(otherRoot, { recursive: true, force: true });
		}
	}, 90_000);

	it("reports the live server through the executable and refuses a duplicate", async () => {
		const record = JSON.parse(runCli(["status", "--json"])) as { port: number; roots: string[] };
		expect(record.port).toBe(Number(new URL(base).port));
		expect(record.roots).toContain(fixtureDir);
		expect(runCli(["status"])).toContain(base);
		expect(() => runCli(["serve", "-w", fixtureDir])).toThrow();
		const response = await fetch(docUrl("alpha.md"));
		expect(response.status).toBe(200);
	}, 30_000);

	it("cleans a populated cache through the executable and can be repeated", async () => {
		const cacheDir = path.join(serverHome, "scratch-cache");
		await fs.mkdir(cacheDir);
		await fs.writeFile(path.join(cacheDir, "obsolete"), "old");
		expect(runCli(["cache", "clean"], { MDXSERVE_CACHE_HOME: cacheDir })).toContain("Removed");
		expect(runCli(["cache", "clean"], { MDXSERVE_CACHE_HOME: cacheDir })).toContain(
			"Nothing to clean",
		);
	}, 30_000);

	it("renders rich content and switches an interactive tab", async () => {
		const { context, page } = await openPage();
		try {
			await page.goto(docUrl("rich.mdx"));
			await page.getByRole("heading", { name: "Rich document" }).waitFor();
			await page.getByRole("cell", { name: "Visible row" }).waitFor();
			await page.getByText("Useful note").waitFor();
			await page.getByRole("tab", { name: "Second" }).click();
			await page.getByRole("tabpanel").getByText("Second panel").waitFor();
			expect(await page.getByRole("tabpanel").getByText("First panel").count()).toBe(0);
		} finally {
			await context.close();
		}
	}, 90_000);

	it("opens a CLI standalone export as a local HTML page", async () => {
		const output = path.join(serverHome, "rich-export.html");
		execFileSync(
			process.execPath,
			[
				"--import",
				"tsx",
				"src/index.ts",
				"export",
				path.join(fixtureDir, "rich.mdx"),
				"-o",
				output,
				"--mermaid",
				"none",
			],
			{
				cwd: repoRoot,
				env: { ...process.env, MDXSERVE_HOME: path.join(serverHome, "export-home") },
				stdio: "pipe",
				timeout: 120_000,
			},
		);
		const { context, page } = await openPage();
		try {
			await page.goto(pathToFileURL(output).href);
			await page.getByRole("heading", { name: "Rich document" }).waitFor();
			await page.getByRole("cell", { name: "Visible row" }).waitFor();
			await page.getByRole("tab", { name: "Second" }).click();
			await page.getByText("Second panel").waitFor();
		} finally {
			await context.close();
		}
	}, 180_000);

	it("downloads a viewer export that opens as a local HTML page", async () => {
		const { context, page } = await openPage();
		try {
			await context.addInitScript(() => {
				Object.defineProperty(window, "showSaveFilePicker", {
					value: async () => {
						throw new DOMException("Gesture expired", "SecurityError");
					},
				});
			});
			await page.goto(docUrl("rich.mdx"));
			await page.getByRole("heading", { name: "Rich document" }).waitFor();
			const downloadPending = page.waitForEvent("download", { timeout: 120_000 });
			await page.getByRole("combobox", { name: /Export page/ }).click();
			await page.getByRole("option", { name: /HTML/ }).click();
			const download = await downloadPending;
			const output = path.join(serverHome, "viewer-export.html");
			await download.saveAs(output);
			const exported = await context.newPage();
			await exported.goto(pathToFileURL(output).href);
			await exported.getByRole("heading", { name: "Rich document" }).waitFor();
			await exported.getByText("Useful note").waitFor();
		} finally {
			await context.close();
		}
	}, 180_000);

	it("selects only documents for bulk trash and preserves them on cancel", async () => {
		const documentCount = (await fs.readdir(fixtureDir)).filter((name) =>
			/\.mdx?$/i.test(name),
		).length;
		const { context, page } = await openPage();
		try {
			await page.goto(`${base}${encodeURI(fixtureDir)}/`);
			await page.getByRole("button", { name: "Select" }).click();
			await page.getByRole("button", { name: /All documents/ }).click();
			await page.getByText(`${documentCount} selected`).waitFor();
			expect(await page.getByRole("checkbox", { name: /Select notes.txt/ }).count()).toBe(0);
			await page.getByRole("button", { name: /Delete/ }).click();
			await page.getByRole("alertdialog").getByText(`Delete ${documentCount} files?`).waitFor();
			await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
			expect(await fs.readFile(path.join(fixtureDir, "alpha.md"), "utf8")).toContain("# Alpha");
			expect(await fs.readFile(path.join(fixtureDir, "beta.mdx"), "utf8")).toContain("# Beta");
			expect(await fs.readFile(path.join(fixtureDir, "notes.txt"), "utf8")).toBe(
				"Not a document.\n",
			);
		} finally {
			await context.close();
		}
	}, 90_000);

	it("navigates folders and documents with browser history", async () => {
		const { context, page } = await openPage();
		try {
			await page.goto(`${base}${encodeURI(fixtureDir)}/`);
			await page.getByRole("link", { name: /Alpha/ }).click();
			await page.getByRole("heading", { name: "Alpha" }).waitFor();
			expect(new URL(page.url()).pathname).toBe(path.join(fixtureDir, "alpha.md"));
			await page.goBack();
			await page.getByRole("link", { name: /Beta/ }).waitFor();
			await page.goForward();
			await page.getByRole("heading", { name: "Alpha" }).waitFor();
		} finally {
			await context.close();
		}
	}, 90_000);

	it("shows a usable route back from a missing document", async () => {
		const { context, page } = await openPage();
		try {
			await page.goto(docUrl("missing.md"));
			await page.getByRole("heading", { name: "Not found" }).waitFor();
			await page.getByRole("link", { name: /Back to/ }).click();
			await page.getByRole("link", { name: /Alpha/ }).waitFor();
		} finally {
			await context.close();
		}
	}, 90_000);

	it("uses the table of contents and next page link", async () => {
		const { context, page } = await openPage();
		try {
			await page.goto(docUrl("alpha.md"));
			await page.getByRole("heading", { name: "Alpha" }).waitFor();
			await page
				.locator("nav")
				.filter({ hasText: "On this page" })
				.getByRole("link", { name: "Details" })
				.click();
			expect(new URL(page.url()).hash).toBe("#details");
			const nextLink = page.getByRole("link", { name: /Next/i });
			const nextHref = await nextLink.getAttribute("href");
			expect(nextHref).toBeTruthy();
			await nextLink.click();
			await page.waitForURL(new URL(nextHref!, base).href);
			await page.getByRole("heading", { level: 1 }).waitFor();
		} finally {
			await context.close();
		}
	}, 90_000);

	it("searches by body text and opens the selected result", async () => {
		const { context, page } = await openPage();
		try {
			await page.goto(docUrl("alpha.md"));
			await page.getByRole("button", { name: /Search docs/ }).click();
			await page.getByText("Nested page.").waitFor();
			await page.getByPlaceholder("Search docs").fill("constellation");
			await page.getByText("Nested page.").waitFor({ state: "detached" });
			await page.getByText("Searchable constellation text.").waitFor();
			await page.getByPlaceholder("Search docs").press("Enter");
			await page.getByRole("heading", { name: "Beta" }).waitFor();
			expect(new URL(page.url()).pathname).toBe(path.join(fixtureDir, "beta.mdx"));
		} finally {
			await context.close();
		}
	}, 90_000);

	it("saves and cancels an in-place section edit", async () => {
		const { context, page } = await openPage();
		try {
			await page.goto(docUrl("alpha.md"));
			await page.getByRole("heading", { name: "Alpha" }).waitFor();
			await page.getByRole("button", { name: "Edit section" }).first().click({ force: true });
			const editor = page.locator('[aria-label="Section editor"]');
			await editor.waitFor();
			await editor.fill("# Alpha\n\nEdited through the browser.");
			await editor.press("Meta+s");
			await editor.waitFor({ state: "hidden", timeout: 8_000 }).catch(async (error: unknown) => {
				throw new Error(
					`${String(error)}\nPage: ${(await page.locator("body").innerText()).slice(0, 3000)}`,
				);
			});
			await page.getByText("Edited through the browser.").waitFor();
			expect(await fs.readFile(path.join(fixtureDir, "alpha.md"), "utf8")).toContain(
				"Edited through the browser.",
			);

			await page.getByRole("button", { name: "Edit section" }).first().click({ force: true });
			await editor.waitFor();
			await editor.fill("Discard this change");
			await editor.press("Escape");
			expect(await fs.readFile(path.join(fixtureDir, "alpha.md"), "utf8")).not.toContain(
				"Discard this change",
			);
		} finally {
			await context.close();
		}
	}, 120_000);

	it("updates an open document after an external save", async () => {
		const { context, page } = await openPage();
		try {
			await page.goto(docUrl("beta.mdx"));
			await page.getByRole("heading", { name: "Beta" }).waitFor();
			await fs.writeFile(
				path.join(fixtureDir, "beta.mdx"),
				"# Beta\n\nUpdated constellation text.\n",
			);
			await page.getByText("Updated constellation text.").waitFor({ timeout: 30_000 });
		} finally {
			await context.close();
		}
	}, 90_000);

	it("updates an open folder when a document is added and renamed", async () => {
		const first = path.join(fixtureDir, "watcher-new.md");
		const renamed = path.join(fixtureDir, "watcher-renamed.md");
		const { context, page } = await openPage();
		try {
			await page.goto(`${base}${encodeURI(fixtureDir)}/`);
			await page.getByRole("link", { name: /Alpha/ }).waitFor();
			await fs.writeFile(first, "# Watcher new\n");
			await page.getByRole("link", { name: /Watcher new/ }).waitFor({ timeout: 30_000 });
			await fs.rename(first, renamed);
			await page
				.locator('a[href$="/watcher-new.md"]')
				.waitFor({ state: "detached", timeout: 30_000 });
			await page.locator('a[href$="/watcher-renamed.md"]').waitFor({ timeout: 30_000 });
		} finally {
			await context.close();
			await fs.rm(first, { force: true });
			await fs.rm(renamed, { force: true });
		}
	}, 90_000);

	it("persists a selected theme and hides controls for print", async () => {
		const { context, page } = await openPage();
		try {
			await page.goto(docUrl("beta.mdx"));
			await page.getByRole("heading", { name: "Beta" }).waitFor();
			await page.getByRole("button", { name: "Dark mode" }).click();
			expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
			await page.reload();
			await page.getByRole("heading", { name: "Beta" }).waitFor();
			expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
			await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
			expect(await page.getByRole("heading", { name: "Beta" }).isVisible()).toBe(true);
			expect(await page.getByRole("button", { name: "Light mode" }).isVisible()).toBe(false);
		} finally {
			await context.close();
		}
	}, 90_000);
});
