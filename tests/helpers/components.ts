import { builtins } from "../../client/builtins/index.js";

/** Names of every real builtin component, the set the server passes to `remarkRestrict`. */
export const builtinNames: readonly string[] = builtins.map((builtin) => builtin.name);
