import http from "node:http";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Connect, Plugin } from "vite";

/** The filled shell keeps each block between `<!--mdxserve:<name>-->` and `<!--/mdxserve:<name>-->`. */
const FILLED_BLOCK = /<!--mdxserve:(head|body)-->([\s\S]*?)<!--\/mdxserve:\1-->/g;

/**
 * A page navigation on the dev server. Vite's own requests (`/@vite/client`, modules,
 * `/node_modules/...`) never ask for HTML, and `/__mdxserve` goes through the proxy.
 */
function isNavigation(req: Connect.IncomingMessage): boolean {
	const url = req.url ?? "/";
	if (req.method !== "GET" && req.method !== "HEAD") return false;
	if (url.startsWith("/@") || url.startsWith("/__mdxserve/")) return false;
	return (req.headers.accept ?? "").includes("text/html");
}

/** Forward one request to the backend as is, keeping its `Host` so the backend's checks see the dev origin. */
function requestBackend(
	backend: URL,
	req: Connect.IncomingMessage,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
	return new Promise((resolve, reject) => {
		const forwarded = http.request(
			{
				hostname: backend.hostname,
				port: backend.port,
				method: req.method,
				path: req.url,
				headers: { ...req.headers, "accept-encoding": "identity" },
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () =>
					resolve({
						status: response.statusCode ?? 502,
						headers: response.headers,
						body: Buffer.concat(chunks),
					}),
				);
				response.on("error", reject);
			},
		);
		forwarded.on("error", reject);
		forwarded.end();
	});
}

/**
 * Dev only. The backend fills the built `index.html` with the route JSON and head metadata;
 * on the dev server a page navigation asks the backend for that shell, moves its filled
 * blocks into the source `apps/web/src/index.html`, and runs Vite's HTML transform, so the page
 * loads the client from source with HMR. Anything that is not the shell (a redirect, a
 * file in a root, an HTML file in a root) is passed back unchanged.
 */
export function devShell(): Plugin {
	return {
		name: "mdxserve:dev-shell",
		apply: "serve",
		configureServer(server) {
			const backend = new URL(process.env.MDXSERVE_DEV_BACKEND ?? "http://127.0.0.1:4041");
			const templatePath = path.join(server.config.root, "index.html");
			server.middlewares.use((req, res, next) => {
				if (!isNavigation(req)) {
					next();
					return;
				}
				void (async () => {
					const response = await requestBackend(backend, req);
					// Only the backend's shell carries filled blocks. Anything else, an HTML
					// file in a root included, goes back unchanged with its own headers.
					const contentType = String(response.headers["content-type"] ?? "");
					const blocks = new Map<string, string>();
					if (contentType.startsWith("text/html")) {
						for (const match of response.body.toString("utf8").matchAll(FILLED_BLOCK)) {
							blocks.set(match[1], match[2]);
						}
					}
					if (!blocks.has("body")) {
						const { "transfer-encoding": _, ...headers } = response.headers;
						res.writeHead(response.status, headers);
						res.end(response.body);
						return;
					}
					const template = await fsp.readFile(templatePath, "utf8");
					const filled = template.replace(
						/<!--mdxserve:(head|body)-->/g,
						(_, name: string) => blocks.get(name) ?? "",
					);
					const html = await server.transformIndexHtml(req.url ?? "/", filled);
					res.statusCode = response.status;
					res.setHeader("Content-Type", "text/html; charset=utf-8");
					res.end(html);
				})().catch(next);
			});
		},
	};
}
