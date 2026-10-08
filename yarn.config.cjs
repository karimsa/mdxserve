const { defineConfig } = require("@yarnpkg/types");

// Keep the whole @tiptap family pinned in package.json, including transitive
// extensions: their caret dependencies can select releases whose exact peers
// conflict with our core/pm. npm consumers do not use our Yarn lockfile or
// resolutions. Update these pins together and run yarn smoke before releasing.

/**
 * This rule will enforce that a workspace MUST depend on the same version of
 * a dependency as the one used by the other workspaces.
 */
function exactRange(range) {
	return range.startsWith("^") || range.startsWith("~") ? range.slice(1) : range;
}

function enforceConsistentDependenciesAcrossTheProject({ Yarn }) {
	for (const dependency of Yarn.dependencies()) {
		if (dependency.type === "peerDependencies") {
			continue;
		}
		if (dependency.ident === "pdfjs-dist") {
			continue;
		}

		for (const otherDependency of Yarn.dependencies({
			ident: dependency.ident,
		})) {
			if (otherDependency.type === "peerDependencies") {
				continue;
			}

			dependency.update(exactRange(otherDependency.range));
		}
	}
}

function enforceExactDependencies({ Yarn }) {
	for (const dependency of Yarn.dependencies()) {
		if (dependency.type === "peerDependencies" || dependency.range.startsWith("workspace:")) {
			continue;
		}

		// ensure that there's no uses of ^ or ~, we want only exact versions
		dependency.update(exactRange(dependency.range));
	}
}

module.exports = defineConfig({
	constraints: async (ctx) => {
		enforceConsistentDependenciesAcrossTheProject(ctx);
		enforceExactDependencies(ctx);
	},
});
