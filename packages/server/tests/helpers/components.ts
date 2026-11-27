import { z } from "zod";
import { builtins } from "../../client/builtins/index.js";
import type { Registry } from "../../src/components/registry.js";

/** The registry `yarn build` writes to dist/registry.json, built in memory from the real builtins. */
export const builtinRegistry: Registry = {
	version: 1,
	components: builtins.map(({ name, description, whenToUse, props }) => {
		const hasChildren = "children" in props.shape;
		const schema = hasChildren ? props.omit({ children: true }) : props;
		return {
			name,
			description,
			whenToUse,
			props: z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<
				string,
				unknown
			>,
		};
	}),
};
