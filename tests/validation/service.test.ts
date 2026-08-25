import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationService } from "../../src/validation/service.js";
import type { RenderOutcome } from "../../src/rendering/protocol.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

let root: string;
let outside: string;

beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-validation-svc-")));
	outside = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-validation-svc-outside-")),
	);
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
	await fs.rm(outside, { recursive: true, force: true });
});

async function writeDoc(name: string, content: string): Promise<string> {
	const abs = path.join(root, name);
	await fs.writeFile(abs, content, "utf8");
	return abs;
}

function serviceWith(render?: (absPath: string) => Promise<RenderOutcome>): ValidationService {
	return new ValidationService([{ name: "docs", dir: root }], registry, render);
}

describe("ValidationService.validateDoc", () => {
	it("passes a plain doc with no diagnostics", async () => {
		const abs = await writeDoc("good.md", "# Good\n\nPlain prose about widgets.\n");
		const outcome = await serviceWith().validateDoc({ path: abs, allowRender: false });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") return;
		expect(outcome.result).toMatchObject({ ok: true, path: abs, diagnostics: [], rendered: false });
	});

	it("passes a doc using a registered component with valid props", async () => {
		const abs = await writeDoc("callout.mdx", '# Doc\n\n<Callout tone="warn">Careful.</Callout>\n');
		const outcome = await serviceWith().validateDoc({ path: abs, allowRender: false });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") return;
		expect(outcome.result.ok).toBe(true);
	});

	it("reports an unknown component as an error, with a did-you-mean suggestion", async () => {
		const abs = await writeDoc("typo.mdx", "# Doc\n\n<Calout>Oops.</Calout>\n");
		const outcome = await serviceWith().validateDoc({ path: abs, allowRender: false });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") return;
		expect(outcome.result.ok).toBe(false);
		const diagnostic = outcome.result.diagnostics.find(
			(entry) => entry.code === "unknown-component",
		);
		expect(diagnostic).toBeDefined();
		expect(diagnostic?.severity).toBe("error");
		expect(diagnostic?.suggestions).toContain("Callout");
	});

	it("reports an unknown prop on a known component", async () => {
		const abs = await writeDoc("prop.mdx", '# Doc\n\n<Badge notAProp="x">Hi</Badge>\n');
		const outcome = await serviceWith().validateDoc({ path: abs, allowRender: false });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") return;
		const diagnostic = outcome.result.diagnostics.find((entry) => entry.code === "unknown-prop");
		expect(diagnostic?.prop).toBe("notAProp");
		expect(diagnostic?.component).toBe("Badge");
	});

	it("reports MDX that does not compile, with a line number", async () => {
		const abs = await writeDoc("broken.mdx", "# Doc\n\n<Callout>unclosed\n");
		const outcome = await serviceWith().validateDoc({ path: abs, allowRender: false });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") return;
		const diagnostic = outcome.result.diagnostics.find((entry) => entry.code === "mdx-compile");
		expect(diagnostic?.severity).toBe("error");
		expect(typeof diagnostic?.line).toBe("number");
	});

	it("reports a relative import that resolves to nothing", async () => {
		const abs = await writeDoc("import.mdx", '# Doc\n\nimport Thing from "./nope.tsx";\n\nText.\n');
		const outcome = await serviceWith().validateDoc({ path: abs, allowRender: false });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") return;
		expect(outcome.result.diagnostics.some((entry) => entry.code === "unresolved-import")).toBe(
			true,
		);
	});

	it("reports a path outside every root as not-found, without reading it", async () => {
		const secret = path.join(outside, "secret.md");
		await fs.writeFile(secret, "# Secret\n", "utf8");
		const outcome = await serviceWith().validateDoc({ path: secret, allowRender: false });
		expect(outcome.kind).toBe("not-found");
	});

	it("reports a missing file as not-found", async () => {
		const outcome = await serviceWith().validateDoc({
			path: path.join(root, "gone.md"),
			allowRender: false,
		});
		expect(outcome.kind).toBe("not-found");
	});

	it("resolves a root-relative path when exactly one root has that file", async () => {
		await writeDoc("relative.md", "# Relative\n\nProse.\n");
		const outcome = await serviceWith().validateDoc({
			path: "relative.md",
			allowRender: false,
		});
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") return;
		expect(outcome.result.path).toBe(path.join(root, "relative.md"));
	});

	it("runs the render step only when allowRender is true", async () => {
		const abs = await writeDoc("render.md", "# Render\n\nProse.\n");
		const render = vi.fn(async (): Promise<RenderOutcome> => ({ ok: true }));

		const withoutRender = await serviceWith(render).validateDoc({ path: abs, allowRender: false });
		expect(render).not.toHaveBeenCalled();
		expect(withoutRender.kind === "ok" && withoutRender.result.rendered).toBe(false);

		const withRender = await serviceWith(render).validateDoc({ path: abs, allowRender: true });
		expect(render).toHaveBeenCalledWith(abs);
		expect(withRender.kind === "ok" && withRender.result.rendered).toBe(true);
	});

	it("turns a failed render into a render-error diagnostic", async () => {
		const abs = await writeDoc("throws.md", "# Throws\n\nProse.\n");
		const render = vi.fn(async (): Promise<RenderOutcome> => ({
			ok: false,
			message: "boom at runtime",
		}));
		const outcome = await serviceWith(render).validateDoc({ path: abs, allowRender: true });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") return;
		expect(outcome.result.ok).toBe(false);
		const diagnostic = outcome.result.diagnostics.find((entry) => entry.code === "render-error");
		expect(diagnostic?.message).toContain("boom at runtime");
	});

	it("does not render a doc that already failed the static checks", async () => {
		const abs = await writeDoc("static-fail.mdx", "# Doc\n\n<Calout>Oops.</Calout>\n");
		const render = vi.fn(async (): Promise<RenderOutcome> => ({ ok: true }));
		const outcome = await serviceWith(render).validateDoc({ path: abs, allowRender: true });
		expect(render).not.toHaveBeenCalled();
		expect(outcome.kind === "ok" && outcome.result.rendered).toBe(false);
	});

	it("reports rendered: false when allowRender is true but no render port exists", async () => {
		const abs = await writeDoc("no-port.md", "# Doc\n\nProse.\n");
		const outcome = await serviceWith().validateDoc({ path: abs, allowRender: true });
		expect(outcome.kind === "ok" && outcome.result.rendered).toBe(false);
	});
});

describe("ValidationService.validateText", () => {
	it("validates text that is not what is on disk, against the given path", async () => {
		const abs = await writeDoc("ondisk.mdx", "# Fine\n\nProse.\n");
		const result = await serviceWith().validateText({
			source: "# Doc\n\n<Calout>Oops.</Calout>\n",
			absPath: abs,
		});
		expect(result.ok).toBe(false);
		expect(result.path).toBe(abs);
		expect(await fs.readFile(abs, "utf8")).toBe("# Fine\n\nProse.\n");
	});

	it("defaults to not rendering when allowRender is omitted", async () => {
		const abs = await writeDoc("default.md", "# Doc\n\nProse.\n");
		const render = vi.fn(async (): Promise<RenderOutcome> => ({ ok: true }));
		const result = await serviceWith(render).validateText({ source: "# Doc\n", absPath: abs });
		expect(render).not.toHaveBeenCalled();
		expect(result.rendered).toBe(false);
	});

	it("resolves relative imports against the given path's directory", async () => {
		const abs = path.join(root, "nested", "doc.mdx");
		await fs.mkdir(path.join(root, "nested"));
		await fs.writeFile(path.join(root, "nested", "Widget.tsx"), "export default null;\n", "utf8");
		const result = await serviceWith().validateText({
			source: 'import Widget from "./Widget.tsx";\n\n# Doc\n\nText.\n',
			absPath: abs,
		});
		expect(result.diagnostics.some((entry) => entry.code === "unresolved-import")).toBe(false);
	});
});
