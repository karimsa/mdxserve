import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	getPackageRoot,
	missingBuildArtifact,
	readMermaidVersion,
	readPackageVersion,
} from "../../src/infra/pkg.js";

describe("readPackageVersion", () => {
	it("matches the version in package.json", () => {
		const manifest = JSON.parse(
			fs.readFileSync(path.join(getPackageRoot(), "package.json"), "utf8"),
		) as { version: string };
		expect(readPackageVersion()).toBe(manifest.version);
	});
});

describe("readMermaidVersion", () => {
	it("matches the mermaid version the server package pins", () => {
		const manifest = JSON.parse(
			fs.readFileSync(path.join(getPackageRoot(), "package.json"), "utf8"),
		) as { dependencies: Record<string, string> };
		expect(readMermaidVersion()).toBe(manifest.dependencies.mermaid);
	});
});

describe("missingBuildArtifact", () => {
	it("tells both installed and source-checkout users what to do", () => {
		const message = missingBuildArtifact("dist/registry.json");
		expect(message).toContain("dist/registry.json");
		expect(message).toContain("npm i -g @karimsa/mdxserve");
		expect(message).toContain("yarn build");
	});
});
