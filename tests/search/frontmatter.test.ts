import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SearchService } from "../../src/search/service.js";
import { DocCache } from "../../src/docs/doc-cache.js";

describe.each(["md", "mdx"])("frontmatter extraction in .%s", (extension) => {
	it.each(["\n", "\r\n"])(
		"uses visible titles and excerpts and excludes YAML from search (%j)",
		async (eol) => {
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-frontmatter-"));
			try {
				const source = [
					"---",
					"# internalmetadata",
					"secret: hiddenonlytoken",
					"---",
					"",
					"# Visible title",
					"",
					"Searchable body content.",
				].join(eol);
				const file = path.join(dir, `document.${extension}`);
				await fs.writeFile(file, source);
				const cache = new DocCache();
				const doc = cache.read(file, (await fs.stat(file)).mtimeMs);
				expect(doc.h1).toBe("Visible title");
				expect(doc.h1Html).toBe("Visible title");
				expect(doc.lines.join(eol)).toBe(source);
				const search = new SearchService(cache);
				const roots = [{ name: "docs", dir }];
				expect(search.search(roots, "").results).toEqual([
					expect.objectContaining({ title: "Visible title", excerpt: "Searchable body content." }),
				]);
				expect(search.search(roots, "hiddenonlytoken").results).toEqual([]);
				expect(search.search(roots, "internalmetadata").results).toEqual([]);
				expect(search.search(roots, "Searchable").results).toEqual([
					expect.objectContaining({ title: "Visible title", excerpt: "Searchable body content." }),
				]);
			} finally {
				await fs.rm(dir, { recursive: true, force: true });
			}
		},
	);
});
