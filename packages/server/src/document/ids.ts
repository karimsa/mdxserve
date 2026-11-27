import { slug } from "github-slugger";
import { AUTHORED_ID_PATTERN } from "../../shared/builtins/id.js";

/**
 * IDs identify a node across parses. A slug and an authored `id` never
 * contain `~` or `>`; `>` joins the segments of a path and `~` marks a
 * segment the server made up, so a made-up ID can never equal a plain one.
 */

/** The fixed ID of the content before the first heading. */
export const PREAMBLE_ID = "~preamble";

/** A heading's slug, the anchor `rehype-slug` gives a heading whose text is unique. */
export function headingSlug(text: string): string {
	return slug(text);
}

/** True when `id` is a valid authored ID: a letter, then letters, digits, `-` and `_`. */
export function isValidAuthoredId(id: string): boolean {
	return AUTHORED_ID_PATTERN.test(id);
}

/** `<owner>>~<kind>-<n>`, such as `install>~callout-2`. */
function positionalId(owner: string, kind: string, count: number): string {
	return `${owner}>~${kind}-${count}`;
}

/** Join path segments: `guide>install>examples`. */
export function joinPath(segments: readonly string[]): string {
	return segments.join(">");
}

/**
 * Hands out the IDs of one parse. It numbers positional IDs per owner and
 * kind, and guarantees that no two nodes share an ID: an ID that is already
 * taken gets `>~<n>` appended. The rules in the design never produce such a
 * clash; this only guards the corner cases they do not cover (an authored tab
 * `value` that contains `>`, a path that spells another node's ID).
 */
export class IdAllocator {
	private readonly used = new Set<string>();
	private readonly counters = new Map<string, number>();

	/** The next positional ID for a node of `kind` owned by `owner`. */
	positional(owner: string, kind: string): string {
		const key = `${owner}\u0000${kind}`;
		const count = (this.counters.get(key) ?? 0) + 1;
		this.counters.set(key, count);
		return this.claim(positionalId(owner, kind, count));
	}

	/** Take `id`, or the first free `id>~<n>` when it is taken. */
	claim(id: string): string {
		let candidate = id;
		for (let suffix = 2; this.used.has(candidate); suffix++) candidate = `${id}>~${suffix}`;
		this.used.add(candidate);
		return candidate;
	}
}
