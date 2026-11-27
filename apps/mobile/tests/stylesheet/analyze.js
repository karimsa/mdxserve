// Reads the stylesheet module Uniwind generates (compile.js) the way its native runtime does,
// and reports what cannot resolve on a device.
const fs = require("node:fs");
const { stylesheetOutputPath } = require("./compile.js");

/**
 * The `rt => ({ vars, scopedVars, stylesheet })` callback and themes the module registers.
 *
 * @returns {{ generate: (runtime: object) => any, themes: string[] }}
 */
function loadStylesheet(code) {
	let registered = null;
	const fakeRequire = (name) => {
		if (name !== "uniwind") throw new Error(`the stylesheet module requires ${name}`);
		return { Uniwind: { __reinit: (generate, themes) => (registered = { generate, themes }) } };
	};
	new Function("require", code)(fakeRequire);
	if (!registered) throw new Error("the stylesheet module registered nothing with Uniwind");
	return registered;
}

/**
 * The runtime helpers the generated code calls. Uniwind computes these on the device; here a
 * mix of a concrete colour stands for the colour it makes, and a mix of anything else keeps
 * the input that cannot resolve.
 */
function fakeRuntime(theme) {
	return {
		colorScheme: theme,
		// A breakpoint rule (`sm:`, and Tailwind's `container`, which a word in a comment is enough
		// to generate) reads the window's size: a folded iPhone Duo's.
		screen: { width: 466, height: 852 },
		cubicBezier: (...points) => ({ cubicBezier: points }),
		colorMix: (color, weight, mixColor) =>
			typeof color === "string" && /^#[0-9a-f]{6,8}$/i.test(color)
				? `${color.slice(0, 7)}${Math.round(parseFloat(weight) * 2.55)
						.toString(16)
						.padStart(2, "0")}`
				: `color-mix(${color}, ${weight}, ${mixColor})`,
	};
}

/** What can never reach a React Native style as a working value. */
function unusable(value) {
	if (value === undefined || value === null) return "no value";
	if (typeof value === "number") return Number.isFinite(value) ? null : `the number ${value}`;
	if (typeof value === "string") {
		if (value === "unset") return "unset";
		const css = value.match(/\b(var|calc|color-mix|min|max|clamp)\(/);
		if (css) return `CSS ${css[1]}() left in "${value}"`;
	}
	return null;
}

/**
 * A view of `variables` that resolves each one the way the generated getters expect, and
 * records a variable that resolves through itself, directly or through others, instead of
 * recursing forever as the device does.
 */
function tracking(variables, cycles, where) {
	const stack = [];
	const tracker = new Proxy(variables, {
		get(target, name) {
			const getter = target[name];
			if (typeof getter !== "function" || typeof name !== "string") return getter;
			return () => {
				if (stack.includes(name)) {
					cycles.add(`${where}${[...stack.slice(stack.indexOf(name)), name].join(" → ")}`);
					return undefined;
				}
				stack.push(name);
				try {
					return getter(tracker);
				} finally {
					stack.pop();
				}
			};
		},
	});
	return tracker;
}

/**
 * Every variable and every class of `theme`, resolved as Uniwind's native runtime resolves them
 * (uniwind/src/core/native/store.ts): the theme's variables over the platform's over the
 * global ones, and for a class, its own `--*` entries laid over those before its properties
 * are read. Returns each cycle found, every variable's value and every class's style with no
 * state (not pressed, not hovered).
 *
 * @returns {{ cycles: string[], variables: Record<string, unknown>, classes: Record<string, Record<string, unknown>> }}
 */
function resolveTheme(sheet, theme) {
	const runtime = fakeRuntime(theme);
	const { vars, scopedVars, stylesheet } = sheet.generate(runtime);
	const themeVars = Object.assign(
		Object.create(
			Object.assign(
				{},
				vars,
				scopedVars["__uniwind-platform-native"] ?? {},
				scopedVars["__uniwind-platform-ios"] ?? {},
			),
		),
		scopedVars[`__uniwind-theme-${theme}`] ?? {},
	);
	const cycles = new Set();

	const tracker = tracking(themeVars, cycles, "");
	const variables = {};
	for (const name in themeVars) {
		if (name.startsWith("--")) variables[name] = tracker[name]();
	}

	const classes = {};
	for (const [className, rules] of Object.entries(stylesheet)) {
		const layer = Object.create(themeVars);
		const getters = {};
		for (const rule of rules) {
			if (!rule.matches(runtime, { scopedTheme: null, variables: null }, {}, {}, layer)) continue;
			for (const [property, getter] of rule.entries) {
				if (property.startsWith("-")) layer[property] = getter;
				else getters[property] = getter;
			}
		}
		const classTracker = tracking(layer, cycles, `${className}: `);
		classes[className] = Object.fromEntries(
			Object.entries(getters).map(([property, getter]) => [property, getter(classTracker)]),
		);
	}
	return { cycles: [...cycles], variables, classes };
}

/** The stylesheet global-setup.js compiled for this test run. */
function loadCompiledStylesheet() {
	return loadStylesheet(fs.readFileSync(stylesheetOutputPath, "utf8"));
}

module.exports = { loadCompiledStylesheet, resolveTheme, unusable };
