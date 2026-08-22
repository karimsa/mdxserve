import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { builtins } from "../client/builtins/index.js";

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(pkgRoot, "dist");
const outFile = path.join(outDir, "registry.json");

const components = builtins.map(({ name, description, whenToUse, props }) => {
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
