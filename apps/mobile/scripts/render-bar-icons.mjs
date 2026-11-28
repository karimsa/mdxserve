// Renders the icons of a diagram's full screen view (src/diagram/bar-icons.ts) from the same
// lucide glyphs the app's Icon draws (stroke 1.75), as PNGs at 1×, 2× and 3×. The native bar
// shows them as template images, tinted like any bar item, so on a folded iPhone Duo the
// vertical bar's items match the inline diagram's controls and one another in size.
// Run `yarn mobile bar-icons` after changing the list, and commit the PNGs it writes.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const mobileRoot = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const iconsDirectory = resolve(dirname(require.resolve("lucide-react-native")), "icons");

/** The bar's icons, by lucide name. */
const NAMES = [
	"plus",
	"maximize",
	"minus",
	"arrow-down",
	"arrow-up",
	"arrow-left",
	"arrow-right",
	"code",
	"x",
];

/** The icon's side in points: the size of a bar item's glyph. */
const POINTS = 22;

/** A lucide icon's elements, read from lucide-react-native's CommonJS build. */
function iconNode(name) {
	const source = readFileSync(resolve(iconsDirectory, `${name}.js`), "utf8");
	const match = /createLucideIcon\("[^"]+", (\[[\s\S]*?\])\);/.exec(source);
	if (!match) throw new Error(`No lucide icon ${name}`);
	return new Function(`return ${match[1]};`)();
}

function svg(name, pixels) {
	const elements = iconNode(name)
		.map(([tag, attributes]) => {
			const pairs = Object.entries(attributes)
				.filter(([key]) => key !== "key")
				.map(([key, value]) => `${key}="${value}"`)
				.join(" ");
			return `<${tag} ${pairs}/>`;
		})
		.join("");
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 24 24" ` +
		`fill="none" stroke="#000" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">` +
		`${elements}</svg>`
	);
}

mkdirSync(resolve(mobileRoot, "assets/bar-icons"), { recursive: true });
for (const name of NAMES) {
	for (const scale of [1, 2, 3]) {
		const file = `assets/bar-icons/${name}${scale === 1 ? "" : `@${scale}x`}.png`;
		await sharp(Buffer.from(svg(name, POINTS * scale)))
			.png({ compressionLevel: 9 })
			.toFile(resolve(mobileRoot, file));
		console.log(`Wrote ${file}`);
	}
}
