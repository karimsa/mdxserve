import { createContext } from "react";
export type ExistingDiagram = { index: number; source: string };
/** Only editable Markdown sections provide this; exports and standalone components do not. */
export const DiagramEditContext = createContext<((target: ExistingDiagram) => void) | null>(null);
