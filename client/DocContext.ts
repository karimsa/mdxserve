import { createContext } from "react";

/**
 * The absolute on-disk path of the doc currently rendering. Provided by
 * `DocView` around the compiled MDX module's `<Content/>`, so any
 * `MdSection` inside it (including nested ones re-imported via HMR) can
 * reach the path without threading it through every builtin's props.
 *
 * `null` outside a doc render — e.g. `MdSection` also has to work when the
 * SSR worker (`client/ssr-entry.tsx`) renders a doc module directly for
 * `validate_doc`, which has no router and thus no provider above it. See the
 * `location`-based fallback in `client/MdSection.tsx`.
 */
export const DocContext = createContext<{ path: string } | null>(null);
