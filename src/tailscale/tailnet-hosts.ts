import type { TailscaleDetection } from "./service.js";

/** The shortest gap between two detections a refresh will start. */
const REFRESH_FLOOR_MS = 10_000;

/**
 * The `Host` values `tailscale serve` publishes this server under, as last
 * detected. One per process, owned by `startServer`.
 *
 * A refresh runs detection again at most once per `floorMs`, and callers
 * that ask while one is running share it, so a page that keeps opening
 * sockets with a foreign `Host` costs at most one CLI call per window.
 */
export class TailnetHosts {
	private hosts: ReadonlySet<string> = new Set();
	private last: TailscaleDetection | undefined;
	private inFlight: Promise<TailscaleDetection> | undefined;
	private startedAt = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly detect: () => Promise<TailscaleDetection>,
		private readonly floorMs = REFRESH_FLOOR_MS,
		private readonly now: () => number = Date.now,
	) {}

	/** Lower-cased `Host` values, port included unless it is 443. */
	current(): ReadonlySet<string> {
		return this.hosts;
	}

	/**
	 * Detect again, unless a detection started less than `floorMs` ago; then
	 * resolve with that one. Never rejects.
	 */
	refresh(): Promise<TailscaleDetection> {
		if (this.inFlight) return this.inFlight;
		if (this.last && this.now() - this.startedAt < this.floorMs) return Promise.resolve(this.last);
		this.startedAt = this.now();
		const pending = this.detect()
			.catch((error: unknown): TailscaleDetection => ({ kind: "failed", message: String(error) }))
			.then((detection) => {
				this.last = detection;
				// A failed call is usually a slow CLI; keep what was known rather
				// than drop a working tailnet reader for one timeout.
				if (detection.kind === "running") {
					this.hosts = new Set(detection.addresses.map((address) => address.host.toLowerCase()));
				} else if (detection.kind !== "failed") {
					this.hosts = new Set();
				}
				return detection;
			})
			.finally(() => {
				this.inFlight = undefined;
			});
		this.inFlight = pending;
		return pending;
	}
}
