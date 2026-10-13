import { describe, expect, it } from "vitest";
import { docModuleUrl } from "../../client/doc-module-cache";

describe("Vite document module URL", () => {
	it("keeps URL punctuation and Unicode inside the filesystem path during refresh", () => {
		expect(docModuleUrl("/notes/a # café?.mdx", "42-2")).toBe(
			"/@fs/notes/a%20%23%20caf%C3%A9%3F.mdx?mdxserve_refresh=42-2",
		);
	});
});
