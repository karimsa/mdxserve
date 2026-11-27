// Before the component tests: compile the app's real stylesheet (compile.js) to the file
// jest.config.js maps every stylesheet import to, so components render with the styles the
// device gets instead of none.
const fs = require("node:fs");
const path = require("node:path");
const { compileStylesheet, stylesheetOutputPath } = require("./compile.js");

module.exports = async function compileNativeStylesheet() {
	const code = await compileStylesheet("ios");
	fs.mkdirSync(path.dirname(stylesheetOutputPath), { recursive: true });
	fs.writeFileSync(stylesheetOutputPath, code);
};
