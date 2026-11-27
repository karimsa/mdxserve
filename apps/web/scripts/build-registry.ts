import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { builtinCatalog } from "../src/builtins/catalog.js";
import { builtinPropSchemas } from "@mdxserve/shared/builtins";

// The server package ships the registry; the web client holds each builtin's description.
const outDir = fileURLToPath(new URL("../../../packages/server/dist", import.meta.url));
const outFile = path.join(outDir, "registry.json");

const components = builtinCatalog.map(({ name, description, whenToUse }) => {
	// The prop schemas live in @mdxserve/shared so the server's document parser checks
	// props against the same objects; the client only adds the component.
	const props = builtinPropSchemas[name];
	if (!props) throw new Error(`No prop schema in @mdxserve/shared/builtins for builtin ${name}`);
	const hasChildren = "children" in props.shape;
	const dataProps = hasChildren ? props.omit({ children: true }) : props;
	// "input" mode: props with defaults are optional for the author, not required.
	// `unrepresentable: "any"` lets z.custom<T>() props (e.g. Button's onClick
	// handler) serialize as `{}` (shown as type `any`) instead of throwing.
	const schema = z.toJSONSchema(dataProps, { io: "input", unrepresentable: "any" });

	const entry: {
		name: string;
		description: string;
		whenToUse: string;
		props: unknown;
		children?: string;
	} = {
		name,
		description,
		whenToUse,
		props: schema,
	};

	if (hasChildren) {
		const childrenSchema = props.shape.children as { description?: string };
		entry.children = childrenSchema.description ?? "";
	}

	return entry;
});

const registry = {
	version: 1,
	components,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(registry, null, 2) + "\n");

console.log(`Wrote ${components.length} component(s) to ${outFile}`);
