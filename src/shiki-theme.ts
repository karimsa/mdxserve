import type { ThemeRegistrationRaw } from "shiki";

// rehype-pretty-code tells a single JSON theme apart from a `{light, dark}`
// theme map at runtime by checking `Object.hasOwn(value, "tokenColors")`
// (see its `isJSONTheme` helper) — so this array must be exposed under the
// `tokenColors` key for that detection to work, while shiki/vscode-textmate's
// `ThemeRegistrationRaw` type requires a `settings` key with the same shape.
// Both keys point at the same array to satisfy each.
const tokenColors: NonNullable<ThemeRegistrationRaw["settings"]> = [
  // Comments — gray-400, no italics.
  {
    scope: [
      "comment",
      "comment.line",
      "comment.block",
      "comment.block.documentation",
      "punctuation.definition.comment",
    ],
    settings: {
      foreground: "#9ca3af",
      fontStyle: "normal",
    },
  },
  // Punctuation / brackets / generic delimiters — gray-400.
  {
    scope: [
      "punctuation",
      "punctuation.separator",
      "punctuation.terminator",
      "punctuation.definition.tag",
      "punctuation.definition.block",
      "punctuation.definition.parameters",
      "punctuation.definition.string",
      "meta.brace",
      "meta.delimiter",
      "meta.bracket",
    ],
    settings: {
      foreground: "#9ca3af",
    },
  },
  // Keywords, storage, control flow, operators — pink-400.
  {
    scope: [
      "keyword",
      "keyword.control",
      "keyword.operator",
      "keyword.operator.new",
      "keyword.other",
      "storage",
      "storage.type",
      "storage.modifier",
      "constant.language.import-export-all",
      "keyword.control.flow",
      "keyword.control.import",
      "keyword.control.export",
      "keyword.control.from",
      "keyword.control.as",
    ],
    settings: {
      foreground: "#f472b6",
    },
  },
  {
    scope: ["keyword.operator", "punctuation.accessor"],
    settings: {
      foreground: "#f472b6",
    },
  },
  // Strings, regex, template literals — sky-300.
  {
    scope: [
      "string",
      "string.quoted",
      "string.template",
      "string.regexp",
      "punctuation.definition.string.begin",
      "punctuation.definition.string.end",
      "punctuation.support.type.property-name.begin",
      "punctuation.support.type.property-name.end",
    ],
    settings: {
      foreground: "#7dd3fc",
    },
  },
  // Numbers, constants, booleans — amber-300.
  {
    scope: [
      "constant.numeric",
      "constant.language",
      "constant.language.boolean",
      "constant.character",
      "constant.character.escape",
      "constant.other",
      "support.constant",
    ],
    settings: {
      foreground: "#fcd34d",
    },
  },
  // Functions and methods — violet-300.
  {
    scope: [
      "entity.name.function",
      "support.function",
      "meta.function-call",
      "meta.function-call.generic",
      "variable.function",
      "entity.name.function.decorator",
      "meta.decorator",
    ],
    settings: {
      foreground: "#c4b5fd",
    },
  },
  // Python decorators specifically — violet-300 (kept for symmetry with
  // functions above; belt-and-suspenders for grammars that split scopes).
  {
    scope: ["punctuation.definition.decorator", "entity.name.function.decorator.python"],
    settings: {
      foreground: "#c4b5fd",
    },
  },
  // Types, classes, interfaces, HTML/JSX tags — teal-300.
  {
    scope: [
      "entity.name.type",
      "entity.name.class",
      "entity.other.inherited-class",
      "support.type",
      "support.class",
      "storage.type.class",
      "entity.name.tag",
      "meta.tag",
    ],
    settings: {
      foreground: "#5eead4",
    },
  },
  // Properties, attributes, object/JSON keys — indigo-300.
  {
    scope: [
      "variable.other.property",
      "variable.other.object.property",
      "meta.object-literal.key",
      "support.type.property-name",
      "support.type.property-name.json",
      "entity.other.attribute-name",
      "meta.attribute",
    ],
    settings: {
      foreground: "#a5b4fc",
    },
  },
  // Plain variables and identifiers — gray-200 (theme default text).
  {
    scope: ["variable", "variable.other", "variable.parameter", "variable.language"],
    settings: {
      foreground: "#e5e7eb",
    },
  },
  // Markdown / MDX prose within fenced blocks — headings pink, links sky.
  {
    scope: ["markup.heading", "entity.name.section.markdown"],
    settings: {
      foreground: "#f472b6",
      fontStyle: "bold",
    },
  },
  {
    scope: ["markup.underline.link", "string.other.link", "markup.link"],
    settings: {
      foreground: "#7dd3fc",
    },
  },
  {
    scope: ["markup.bold"],
    settings: {
      fontStyle: "bold",
    },
  },
  {
    scope: ["markup.italic"],
    settings: {
      fontStyle: "italic",
    },
  },
  {
    scope: ["markup.inline.raw", "markup.raw"],
    settings: {
      foreground: "#7dd3fc",
    },
  },
  // CSS — selectors teal, properties indigo, values sky.
  {
    scope: ["entity.name.tag.css", "entity.other.attribute-name.class.css", "entity.other.attribute-name.id.css"],
    settings: {
      foreground: "#5eead4",
    },
  },
  {
    scope: ["support.type.property-name.css", "meta.property-name.css"],
    settings: {
      foreground: "#a5b4fc",
    },
  },
  {
    scope: [
      "support.constant.property-value.css",
      "meta.property-value.css",
      "constant.numeric.css",
      "keyword.other.unit.css",
    ],
    settings: {
      foreground: "#7dd3fc",
    },
  },
  // Bash / shell — commands violet, flags gray-200.
  {
    scope: ["entity.name.function.shell", "support.function.builtin.shell", "meta.function-call.shell"],
    settings: {
      foreground: "#c4b5fd",
    },
  },
  {
    scope: ["variable.parameter.option.shell", "constant.other.option.shell"],
    settings: {
      foreground: "#e5e7eb",
    },
  },
];

/**
 * A single dark Shiki/TextMate theme mapping token scopes onto the Tailwind
 * palette, so code blocks read the way Tailwind Plus docs render them —
 * always dark, regardless of the page's own light/dark mode.
 */
export const tailwindPlusTheme: ThemeRegistrationRaw = {
  name: "tailwind-plus",
  type: "dark",
  colors: {
    "editor.background": "#030712",
    "editor.foreground": "#e5e7eb",
  },
  tokenColors,
  settings: tokenColors,
};
