import type { Plugin } from "vite";

// Vite still imports /@vite/client from CSS and modules with import.meta.hot
// when HMR and its WebSocket server are disabled. The regular client opens a
// WebSocket on import, so serve only the helpers those modules need.
const client = `
const styles = new Map();
export function updateStyle(id, content) {
  let style = styles.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("data-vite-dev-id", id);
    document.head.appendChild(style);
    styles.set(id, style);
  }
  style.textContent = content;
}
export function removeStyle(id) {
  styles.get(id)?.remove();
  styles.delete(id);
}
export function createHotContext() {
  return { accept() {}, prune() {}, dispose() {}, on() {}, off() {}, send() {}, data: {} };
}
export function injectQuery(url, query) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return pathname + "?" + query + (search ? "&" + search.slice(1) : "") + hash;
}
export class ErrorOverlay extends (globalThis.HTMLElement || class {}) {
  constructor(error) {
    super();
    this.textContent = error?.message || String(error);
  }
}
globalThis.customElements?.define?.("mdxserve-immutable-error", ErrorOverlay);
`;

export function immutableClientPlugin(): Plugin {
	return {
		name: "mdxserve:immutable-client",
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				if (request.url?.split("?")[0] !== "/@vite/client") return next();
				response.setHeader("Content-Type", "text/javascript; charset=utf-8");
				response.end(client);
			});
		},
	};
}
