import sharp from "sharp";
export async function normalizeDiagramImage(bytes: Buffer): Promise<Buffer> {
	if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024)
		throw new Error("Image must be at most 10 MiB");
	const image = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
	const metadata = await image.metadata();
	if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1)
		throw new Error("Choose a single PNG, JPEG or WebP image");
	return image
		.rotate()
		.resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
		.png()
		.toBuffer();
}
