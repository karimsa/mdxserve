// Renders the app icon, and the mark the Android adaptive icon and the splash screen show, from
// the project logo (apps/web/src/public/favicon.svg) in the design tokens' colours.
// Run `yarn mobile icon` after the logo or the tokens change, and commit the PNGs it writes.
//
// The logo draws "M↓" in the system monospace font (Menlo on macOS), so render on a Mac to
// match the favicon a browser shows there.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const mobileRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(mobileRoot, "../..");
const size = 1024;

// The tokens move to packages/ui once the app shares them; until then the web client holds them.
const tokenFiles = ["packages/ui/src/tokens/colors.css", "apps/web/src/design/tokens/colors.css"];

function readTokens() {
	for (const file of tokenFiles) {
		try {
			return readFileSync(resolve(repositoryRoot, file), "utf8");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	throw new Error(`No colour tokens in ${tokenFiles.join(" or ")}`);
}

const tokens = readTokens();

/** The light theme's value of a token, following `var(--other)` references. */
function token(name) {
	const declaration = new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens);
	if (!declaration) throw new Error(`No --${name} token`);
	const value = declaration[1].trim();
	const reference = /^var\(--([\w-]+)\)$/.exec(value);
	return reference ? token(reference[1]) : value;
}

// The logo is a dark tile with a light glyph: the inverse surface and the text that sits on it.
const background = token("surface-inverse");
const foreground = token("text-inverse");

const logo = readFileSync(resolve(repositoryRoot, "apps/web/src/public/favicon.svg"), "utf8");

// One <text> element, so a changed logo fails loudly instead of rendering wrong.
const glyphs = logo.match(/<text\b[^>]*>.*?<\/text>/g) ?? [];
if (glyphs.length !== 1) throw new Error(`Expected one <text> in the logo, found ${glyphs.length}`);
const glyph = glyphs[0].replace(/fill="[^"]*"/, `fill="${foreground}"`);
const viewBox = /viewBox="([^"]+)"/.exec(logo)[1];
const [, , logoWidth, logoHeight] = viewBox.split(/\s+/).map(Number);

/**
 * The glyph at `scale` of the canvas, centred where the logo centres it. iOS rounds the corners
 * itself, so the tile becomes a full-bleed square; `withTile` false leaves it transparent.
 */
function iconSvg({ scale, withTile }) {
	const inset = (logoWidth * (1 - scale)) / 2;
	const tile = withTile
		? `<rect width="${logoWidth}" height="${logoHeight}" fill="${background}"/>`
		: "";
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}">` +
		`${tile}<g transform="translate(${inset} ${inset}) scale(${scale})">${glyph}</g></svg>`
	);
}

async function render(svg, file, { opaque }) {
	const image = sharp(Buffer.from(svg));
	// iOS rejects an icon with an alpha channel, even a fully opaque one.
	const output = opaque ? image.flatten({ background }).removeAlpha() : image.ensureAlpha();
	await output.png({ compressionLevel: 9 }).toFile(resolve(mobileRoot, file));
	console.log(`Wrote ${file}`);
}

// The logo's own proportions: the glyph spans about half the width.
await render(iconSvg({ scale: 1, withTile: true }), "assets/icon.png", { opaque: true });
// The adaptive icon's foreground and the splash screen. Android masks the adaptive icon to its
// centre 66 of 108 dp, so the mark shrinks to stay inside.
await render(iconSvg({ scale: 0.7, withTile: false }), "assets/mark.png", { opaque: false });
