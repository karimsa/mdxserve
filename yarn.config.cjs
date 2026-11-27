const { defineConfig } = require("@yarnpkg/types");

// Keep the whole @tiptap family pinned in apps/web/package.json, including transitive
// extensions: their caret dependencies can select releases whose exact peers
// conflict with our core/pm. They are build-time dependencies of the client
// bundle (packages/server/dist/client), so update these pins together and rebuild.

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

// React and the renderer that must match it exactly. Their types follow React's minor version.
const REACT_PACKAGES = ["react", "react-dom"];
const REACT_TYPES = ["@types/react", "@types/react-dom"];

function minorVersion(range) {
	return exactRange(range).split(".").slice(0, 2).join(".");
}

/**
 * Every workspace runs one React: the version the Expo SDK pins, since Expo does not support
 * two copies of React in one monorepo. Unlike the rule above, this one counts peer
 * dependencies too, and it never picks a winner: a disagreement fails `yarn constraints`, so
 * a React upgrade is made in every workspace at once.
 */
function enforceOneReactVersion({ Yarn }) {
	const reactDependencies = Yarn.dependencies().filter((dependency) =>
		REACT_PACKAGES.includes(dependency.ident),
	);
	const versions = new Set(reactDependencies.map((dependency) => exactRange(dependency.range)));
	if (versions.size > 1) {
		const listed = [...versions].sort().join(", ");
		for (const dependency of reactDependencies) {
			dependency.error(
				`${dependency.ident} must be one version in every workspace, with react and react-dom equal; found ${listed}`,
			);
		}
		return;
	}

	const [reactVersion] = versions;
	if (reactVersion === undefined) {
		return;
	}
	for (const dependency of Yarn.dependencies()) {
		if (
			REACT_TYPES.includes(dependency.ident) &&
			minorVersion(dependency.range) !== minorVersion(reactVersion)
		) {
			dependency.error(
				`${dependency.ident} must be a ${minorVersion(reactVersion)}.x release, to match react ${reactVersion}`,
			);
		}
	}
}

module.exports = defineConfig({
	constraints: async (ctx) => {
		enforceConsistentDependenciesAcrossTheProject(ctx);
		enforceExactDependencies(ctx);
		enforceOneReactVersion(ctx);
	},
});
