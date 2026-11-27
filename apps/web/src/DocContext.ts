import { createContext } from "react";

/**
 * The absolute on-disk path of the doc currently rendering. Provided by
 * `DocumentView`, so a builtin's reader state (`useBlockState`), a `Tabs`
 * selection and an edit wrapper can reach the path without threading it
 * through every node's props. `null` outside a doc.
 */
export const DocContext = createContext<{ path: string } | null>(null);
