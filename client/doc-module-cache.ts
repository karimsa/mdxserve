import type { ComponentType } from "react";
import type { DocumentMetadata } from "../src/docs/metadata";

export type DocModuleState =
	| { status: "ok"; Component: ComponentType; metadata: DocumentMetadata }
	| { status: "error"; message: string };

/**
 * Modules imported for doc routes, keyed by the doc's path (its absolute path
 * in the live viewer, an opaque key in an exported file). Shared across the
 * whole session (module scope, not component state) so DocView can render
 * synchronously once a route resolves, and so re-visiting a doc doesn't
 * re-trigger the dynamic import.
 *
 * Lives in its own module — not client/router.ts — so the standalone shell
 * (client/standalone-entry.tsx) can seed and read it without pulling the
 * router's tRPC/react-query graph into an exported file.
 */
export const docModuleCache = new Map<string, DocModuleState>();

/** A Vite /@fs URL whose path remains intact even for URL punctuation in filenames. */
export function docModuleUrl(path: string, refreshToken?: string): string {
	const encodedPath = path.split("/").map(encodeURIComponent).join("/");
	return `/@fs${encodedPath}${refreshToken === undefined ? "" : `?mdxserve_refresh=${refreshToken}`}`;
}
