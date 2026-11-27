import path from "node:path";

const TYPES: Record<string, string> = {
	".apng": "image/apng",
	".avif": "image/avif",
	".bmp": "image/bmp",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".webp": "image/webp",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".mp4": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".pdf": "application/pdf",
	".zip": "application/zip",
	".json": "application/json",
	".wasm": "application/wasm",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".css": "text/css",
	".csv": "text/csv",
	".htm": "text/html",
	".html": "text/html",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".txt": "text/plain",
	".log": "text/plain",
	".xml": "application/xml",
	".xhtml": "application/xhtml+xml",
	".yaml": "text/yaml",
	".yml": "text/yaml",
};

/** Types a browser runs script in when the file is opened as a page. */
const ACTIVE_TYPES = new Set([
	"text/html",
	"image/svg+xml",
	"application/xml",
	"application/xhtml+xml",
]);

/** The `Content-Type` a served file goes out with, from its extension; unknown ones are opaque bytes. */
export function contentTypeOf(filePath: string): string {
	const type = TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
	return type.startsWith("text/") || type === "application/json" ? `${type}; charset=utf-8` : type;
}

/**
 * Whether a file of this type can run script when opened directly. Such a file is served
 * with a sandbox policy, so a page in a root cannot act in the app's origin.
 */
export function isActiveContentType(contentType: string): boolean {
	return ACTIVE_TYPES.has(contentType.split(";")[0]);
}
