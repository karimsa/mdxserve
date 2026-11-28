import { createContext, useContext } from "react";
import type { DiagramSize } from "./size";

const CAPACITY = 200;

/**
 * The natural size of each diagram drawn, by the source sent to Mermaid, so a
 * row that is recycled or remounted reserves its height before it is drawn again and the list
 * does not jump. Holds at most 200 entries; the oldest goes first.
 */
export class DiagramSizes {
	private readonly sizes = new Map<string, DiagramSize>();

	get(source: string): DiagramSize | undefined {
		return this.sizes.get(source);
	}

	set(source: string, size: DiagramSize): void {
		this.sizes.delete(source);
		this.sizes.set(source, size);
		if (this.sizes.size > CAPACITY) {
			const oldest = this.sizes.keys().next().value;
			if (oldest !== undefined) this.sizes.delete(oldest);
		}
	}
}

/**
 * @internal Exported for its tests, which give each render a cache of its own. The app uses the
 * default: one cache for every document, keyed by source, so a diagram drawn once keeps its
 * height wherever it shows again.
 */
export const DiagramSizesContext = createContext(new DiagramSizes());

export function useDiagramSizes(): DiagramSizes {
	return useContext(DiagramSizesContext);
}
