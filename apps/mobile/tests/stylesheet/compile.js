// Compiles the app's stylesheet (src/global.css) into the module Metro serves the app: Uniwind's
// own Metro transformer, given the Uniwind settings metro.config.js sets. Only the step after
// it, Babel over the generated JavaScript, is left out.
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "../..");

/** Where global-setup.js writes the compiled stylesheet for the tests (jest.config.js). */
const stylesheetOutputPath = path.join(
	appRoot,
	"node_modules/.cache/mdxserve/native-stylesheet.ios.js",
);

/** The JavaScript module Uniwind generates for src/global.css on `platform` ("ios"). */
async function compileStylesheet(platform = "ios") {
	const metroConfig = require(path.join(appRoot, "metro.config.js"));
	const transformerConfig = { ...metroConfig.transformer };
	// Uniwind hands its generated code to this worker; take the code before it does.
	transformerConfig.uniwind = { ...transformerConfig.uniwind, isExpoProject: false };
	const workerPath = require.resolve("metro-transform-worker", {
		paths: [path.dirname(metroConfig.transformerPath)],
	});
	const realWorker = require.cache[workerPath];
	let generated = null;
	require.cache[workerPath] = {
		id: workerPath,
		filename: workerPath,
		loaded: true,
		exports: {
			transform: async (_config, _projectRoot, _filePath, data) => {
				generated = data.toString("utf8");
				return { output: [{ data: {} }] };
			},
		},
	};
	const cwd = process.cwd();
	try {
		// Uniwind finds the entry stylesheet relative to the working directory.
		process.chdir(appRoot);
		const { transform } = require(metroConfig.transformerPath);
		const cssPath = transformerConfig.uniwind.cssEntryFile;
		await transform(
			transformerConfig,
			appRoot,
			path.normalize(cssPath),
			fs.readFileSync(path.join(appRoot, cssPath)),
			{
				platform,
				dev: false,
				type: "module",
			},
		);
	} finally {
		process.chdir(cwd);
		if (realWorker) require.cache[workerPath] = realWorker;
		else delete require.cache[workerPath];
	}
	if (generated === null) throw new Error("Uniwind generated no stylesheet module");
	return generated;
}

module.exports = { compileStylesheet, stylesheetOutputPath };
