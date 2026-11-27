import path from "node:path";
import fs from "node:fs";
import { Worker } from "node:worker_threads";
import { getPackageRoot } from "../../infra/pkg.js";
import { diagramPolicyError } from "../policy.js";
export async function validateDiagram(source: string, signal: AbortSignal): Promise<string | null> {
	const invalid = diagramPolicyError(source);
	if (invalid) return invalid;
	if (signal.aborted) return "Conversion cancelled";
	const workerFile = path.join(getPackageRoot(), "dist", "diagram-worker.js");
	if (!fs.existsSync(workerFile))
		return "Diagram validator is missing. Run yarn build, then restart mdxserve.";
	return new Promise((resolve) => {
		const worker = new Worker(workerFile, {
			workerData: { source },
			resourceLimits: { maxOldGenerationSizeMb: 128 },
		});
		let done = false;
		const finish = (error: string | null) => {
			if (done) return;
			done = true;
			clearTimeout(timeout);
			signal.removeEventListener("abort", cancel);
			void worker.terminate();
			resolve(error);
		};
		const cancel = () => finish("Conversion cancelled");
		const timeout = setTimeout(() => finish("Diagram validation timed out"), 5000);
		signal.addEventListener("abort", cancel, { once: true });
		worker.once("message", (message: unknown) =>
			finish(typeof message === "string" ? message : null),
		);
		worker.once("error", () => finish("Diagram validation failed"));
		worker.once("exit", () => {
			if (!done) finish("Diagram validation stopped");
		});
		if (signal.aborted) cancel();
	});
}
