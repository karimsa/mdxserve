import type { DiagramSize } from "./size";

/**
 * One inline diagram's state. `nodeId` is the code node's id (or the request key when it has
 * none); `requestKey` names what was asked of Mermaid: the source and the theme.
 */
export type DiagramState =
	| { kind: "loading"; nodeId: string; requestKey: string }
	| {
			kind: "drawn";
			nodeId: string;
			requestKey: string;
			size: DiagramSize;
			title: string | null;
			description: string | null;
			/** A newer request is being drawn; the old drawing stays until it arrives (M14). */
			pending: boolean;
	  }
	| { kind: "failed"; nodeId: string; requestKey: string; message: string }
	| { kind: "unavailable"; nodeId: string; requestKey: string };

export type DiagramEvent =
	| { kind: "request"; nodeId: string; requestKey: string }
	| {
			kind: "rendered";
			requestKey: string;
			size: DiagramSize;
			title: string | null;
			description: string | null;
	  }
	| { kind: "error"; requestKey: string; message: string }
	| { kind: "timeout"; requestKey: string }
	| { kind: "retry" };

/** How long a request may go without a drawing or an error before the source is shown (M4). */
export const DIAGRAM_TIMEOUT_MS = 8000;

/** The key of a request: the same source in the same theme is the same request. */
export function diagramRequestKey(source: string, themeVariables: Record<string, string>): string {
	return `${source}\u0000${JSON.stringify(themeVariables)}`;
}

export function initialDiagramState(nodeId: string, requestKey: string): DiagramState {
	return { kind: "loading", nodeId, requestKey };
}

export function diagramReducer(state: DiagramState, event: DiagramEvent): DiagramState {
	switch (event.kind) {
		case "request": {
			if (event.requestKey === state.requestKey && event.nodeId === state.nodeId) return state;
			// The same block with a new source or theme keeps its drawing until the new one lands;
			// another block never shows this one's drawing (M15).
			if (state.kind === "drawn" && event.nodeId === state.nodeId)
				return { ...state, requestKey: event.requestKey, pending: true };
			return initialDiagramState(event.nodeId, event.requestKey);
		}
		case "rendered":
			if (event.requestKey !== state.requestKey) return state;
			return {
				kind: "drawn",
				nodeId: state.nodeId,
				requestKey: state.requestKey,
				size: event.size,
				title: event.title,
				description: event.description,
				pending: false,
			};
		case "error":
			if (event.requestKey !== state.requestKey) return state;
			return {
				kind: "failed",
				nodeId: state.nodeId,
				requestKey: state.requestKey,
				message: event.message,
			};
		case "timeout":
			if (event.requestKey !== state.requestKey) return state;
			if (state.kind === "loading" || (state.kind === "drawn" && state.pending))
				return { kind: "unavailable", nodeId: state.nodeId, requestKey: state.requestKey };
			return state;
		case "retry":
			if (state.kind === "unavailable" || state.kind === "failed")
				return initialDiagramState(state.nodeId, state.requestKey);
			return state;
	}
}
