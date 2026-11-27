import type { DocumentTree } from "@mdxserve/client/document/tree-types";

/**
 * The newest document tree `schemaVersion` this app can render. Typed as the server's own
 * literal, so a new schema version fails to compile here until the app is updated for it.
 */
export const TREE_SCHEMA_VERSION: DocumentTree["schemaVersion"] = 1;
