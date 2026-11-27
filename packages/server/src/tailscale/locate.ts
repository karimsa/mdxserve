import path from "node:path";

/** The name the runner resolves on `PATH`. */
const TAILSCALE_ON_PATH = "tailscale";

/**
 * The Tailscale CLIs to try, in order. `MDXSERVE_TAILSCALE_CLI` replaces the
 * whole list. Otherwise `PATH` comes first, then the install location of the
 * platform's app: the Mac App Store build keeps its CLI inside the app bundle
 * and the Windows installer does not add itself to `PATH` for every shell.
 */
export function tailscaleCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
	const override = env.MDXSERVE_TAILSCALE_CLI?.trim();
	if (override) return [override];
	const candidates = [TAILSCALE_ON_PATH];
	if (platform === "darwin")
		candidates.push("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
	if (platform === "win32") {
		const programFiles = env.ProgramFiles?.trim() || "C:\\Program Files";
		candidates.push(path.win32.join(programFiles, "Tailscale", "tailscale.exe"));
	}
	return candidates;
}
