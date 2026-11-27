import { z } from "zod";
import { builtinPropSchemas } from "@mdxserve/shared/builtins";
import type { Registry } from "../../src/components/registry.js";

/**
 * The registry `yarn build` writes to dist/registry.json, built in memory from the real
 * builtin prop schemas. The server does not depend on the web client, which holds each
 * builtin's description, so those stay empty here.
 */
export const builtinRegistry: Registry = {
	version: 1,
	components: Object.entries(builtinPropSchemas).map(([name, props]) => {
		const hasChildren = "children" in props.shape;
		const schema = hasChildren ? props.omit({ children: true }) : props;
		return {
			name,
			description: "",
			whenToUse: "",
			props: z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<
				string,
				unknown
			>,
		};
	}),
};
