import { VFileMessage } from "vfile-message";
import type { Position } from "unist";
import type { RestrictDiagnosticCode } from "./restrict.js";

export type DocumentDiagnosticCode =
	| RestrictDiagnosticCode
	| "mdx-syntax"
	| "unknown-prop"
	| "invalid-prop"
	| "missing-id"
	| "invalid-id"
	| "duplicate-id"
	| "id-conflicts-with-heading"
	| "duplicate-heading"
	| "duplicate-tab-value"
	| "invalid-tab-default"
	| "invalid-tabs-structure";

/** A problem `DocumentService.parse` found and repaired: the tree it returns still renders. */
export interface DocumentDiagnostic {
	severity: "error" | "warning";
	code: DocumentDiagnosticCode;
	message: string;
	line?: number;
	column?: number;
	endLine?: number;
	endColumn?: number;
	component?: string;
	prop?: string;
	suggestions?: string[];
}

export type DiagnosticPlace = Pick<DocumentDiagnostic, "line" | "column" | "endLine" | "endColumn">;

export function placeOf(position: Position | undefined): DiagnosticPlace {
	if (!position) return {};
	return {
		line: position.start.line,
		column: position.start.column,
		endLine: position.end.line,
		endColumn: position.end.column,
	};
}

/** Where a parser error points, read from a thrown `VFileMessage` or its reason text. */
export function syntaxErrorPlace(error: unknown): DiagnosticPlace & { reason: string } {
	if (!(error instanceof VFileMessage)) {
		return { reason: error instanceof Error ? error.message : String(error) };
	}
	let line = error.line ?? undefined;
	let column = error.column ?? undefined;
	let endLine: number | undefined;
	let endColumn: number | undefined;
	const place = error.place;
	if (place && "start" in place) {
		line = line ?? place.start.line;
		column = column ?? place.start.column;
		endLine = place.end?.line;
		endColumn = place.end?.column;
	} else if (place) {
		line = line ?? place.line;
		column = column ?? place.column;
	}
	// Some messages (an unclosed tag at the end of the file) carry no place;
	// the position is only in the reason text: "… (1:1-1:10)".
	if (line === undefined) {
		const match = error.reason.match(/\((\d+):(\d+)(?:-(\d+):(\d+))?\)/);
		if (match) {
			line = Number(match[1]);
			column = Number(match[2]);
			if (match[3] !== undefined) {
				endLine = Number(match[3]);
				endColumn = Number(match[4]);
			}
		}
	}
	return { reason: error.reason, line, column, endLine, endColumn };
}
