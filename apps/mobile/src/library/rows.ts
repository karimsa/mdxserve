import { displayName, type KnownServer } from "../servers/store";

/** A mounted folder, as `listRoots` returns it. */
export interface Root {
	name: string;
	dir: string;
}

/** What one server's `listRoots` query holds now. */
export type RootsState =
	{ kind: "loading" } | { kind: "ok"; roots: Root[] } | { kind: "failed"; message: string };

export type LibraryRow =
	| { kind: "root"; key: string; server: KnownServer; root: Root }
	| { kind: "loading"; key: string; server: KnownServer }
	| { kind: "unreachable"; key: string; server: KnownServer; message: string };

const byText = (left: string, right: string) =>
	left.localeCompare(right, undefined, { sensitivity: "base" });

/**
 * The Library: every reachable server's roots, sorted by root name and then by server name,
 * each labelled with its server (R1). A server that could not be listed is one row saying so,
 * and a server still loading is one row too; both come after the roots, by server name (R5).
 */
export function libraryRows(
	servers: readonly KnownServer[],
	states: readonly RootsState[],
): LibraryRow[] {
	const roots: LibraryRow[] = [];
	const others: LibraryRow[] = [];
	servers.forEach((server, index) => {
		const state = states[index] ?? { kind: "loading" };
		if (state.kind === "ok") {
			for (const root of state.roots) {
				roots.push({ kind: "root", key: `${server.id}:${root.dir}`, server, root });
			}
		} else if (state.kind === "failed") {
			others.push({ kind: "unreachable", key: server.id, server, message: state.message });
		} else {
			others.push({ kind: "loading", key: server.id, server });
		}
	});
	const serverOrder = (left: LibraryRow, right: LibraryRow) =>
		byText(displayName(left.server), displayName(right.server)) ||
		byText(left.server.id, right.server.id);
	roots.sort(
		(left, right) =>
			(left.kind === "root" && right.kind === "root"
				? byText(left.root.name, right.root.name)
				: 0) || serverOrder(left, right),
	);
	others.sort(serverOrder);
	return [...roots, ...others];
}

/**
 * Whether the Library has shown its first full answer: the stored servers are read and every
 * one of them has answered or failed once. Rows animate only after that.
 */
export function firstAnswersIn(loaded: boolean, states: readonly RootsState[]): boolean {
	return loaded && states.every((state) => state.kind !== "loading");
}
