import type { ComponentType } from "react";
import type { z } from "zod";
import Callout, { calloutProps } from "./Callout";

export interface BuiltinDefinition {
  name: string;
  description: string;
  whenToUse: string;
  props: z.ZodObject<any>;
  Component: ComponentType<any>;
}

export const builtins: BuiltinDefinition[] = [
  {
    name: "Callout",
    description: "A boxed aside with an icon, used to draw attention to a note or warning inline with the text.",
    whenToUse:
      "Use to highlight a tip, note, or warning that should stand out from surrounding prose. Prefer `type=\"warn\"` for caveats or risks and the default `type=\"info\"` for general notes; add `title` when the callout needs a short heading.",
    props: calloutProps,
    Component: Callout,
  },
];

export const builtinComponents: Record<string, ComponentType<any>> = Object.fromEntries(
  builtins.map((b) => [b.name, b.Component])
);
