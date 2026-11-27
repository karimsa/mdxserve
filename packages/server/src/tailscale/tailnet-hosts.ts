import type { TailscaleDetection } from "./service.js";

/**
 * The `Host` values `tailscale serve` publishes this server under, read once
 * when the server starts. One per process, owned by `startServer`. A serve
 * entry added later is picked up by the next server start.
 */
export class TailnetHosts {
	private hosts: ReadonlySet<string> = new Set();
	private detection: Promise<TailscaleDetection> | undefined;

	constructor(private readonly runDetection: () => Promise<TailscaleDetection>) {}

	/** Lower-cased `Host` values, port included unless it is 443. Empty until `detect` resolves. */
	current(): ReadonlySet<string> {
		return this.hosts;
	}

	/** Run detection the first time, and resolve with that result on every call. Never rejects. */
	detect(): Promise<TailscaleDetection> {
		this.detection ??= this.runDetection()
			.catch((error: unknown): TailscaleDetection => ({ kind: "failed", message: String(error) }))
			.then((detection) => {
				if (detection.kind === "running") {
					this.hosts = new Set(detection.addresses.map((address) => address.host.toLowerCase()));
				}
				return detection;
			});
		return this.detection;
	}
}
