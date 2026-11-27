import { parentPort, workerData } from "node:worker_threads";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
try {
	const { default: mermaid } = await import("mermaid");
	mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
	await mermaid.parse(workerData.source);
	parentPort?.postMessage(null);
} catch (error) {
	parentPort?.postMessage(
		(error instanceof Error ? error.message : "Invalid Mermaid").slice(0, 2000),
	);
} finally {
	dom.window.close();
}
