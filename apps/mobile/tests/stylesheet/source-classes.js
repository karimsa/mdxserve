// The class names a shared component's source writes, so a test can check that the app's
// compiled stylesheet styles each one: Uniwind leaves out, without a warning, a class it cannot
// compile for a device.
const fs = require("node:fs");
const path = require("node:path");

const quoted = (text) => [...text.matchAll(/"([^"]*)"/g)].map((match) => match[1]);

/**
 * Every class in a `className="…"` or `` className={`…`} `` of a file under packages/ui/src,
 * with the quoted alternatives inside a template's `${…}`, and the values of its `const NAME = {…}`
 * class maps whose names are listed.
 *
 * @param {string} file the path under packages/ui/src
 * @param {string[]} classMaps names of `const` objects whose values are class lists
 * @returns {string[]}
 */
function classesInSource(file, classMaps = []) {
	return classesIn(path.join(__dirname, "../../../../packages/ui/src", file), classMaps);
}

/**
 * The same, for a file of the app itself.
 *
 * @param {string} file the path under apps/mobile
 * @param {string[]} classMaps names of `const` objects whose values are class lists
 * @returns {string[]}
 */
function classesInAppSource(file, classMaps = []) {
	return classesIn(path.join(__dirname, "../..", file), classMaps);
}

function classesIn(absolutePath, classMaps) {
	const file = path.basename(absolutePath);
	const source = fs.readFileSync(absolutePath, "utf8");
	const lists = [
		...[...source.matchAll(/className="([^"]*)"/g)].map((match) => match[1]),
		...[...source.matchAll(/className=\{`([^`]*)`\}/g)].flatMap((match) => [
			match[1].replace(/\$\{[^}]*\}/g, " "),
			...quoted(match[1]),
		]),
		...classMaps.flatMap((name) => {
			const map = source.match(new RegExp(`const ${name} = \\{([^}]*)\\}`));
			if (!map) throw new Error(`${file} has no class map ${name}`);
			return quoted(map[1]);
		}),
	];
	return [...new Set(lists.flatMap((list) => list.split(/\s+/)).filter(Boolean))];
}

module.exports = { classesInAppSource, classesInSource };
