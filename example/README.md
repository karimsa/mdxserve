# mdxserve example

This folder is both a working example and a test fixture for `mdxserve`. It shows what a docs
folder looks like and exercises the features `mdxserve` needs to render correctly: plain
Markdown, MDX with JSX, custom components, Tailwind typography, nested folders, and non-Markdown
files sitting alongside everything else.

## What is mdxserve

`mdxserve` is a small CLI, similar in spirit to `npx serve`, that serves a folder of Markdown and
MDX files as a browsable site. Point it at a directory and it will:

- List subfolders and `.md` / `.mdx` files when you browse a directory
- Render a file in the browser when you click it, using Vite + MDX
- Apply Tailwind's `prose` typography styles automatically, so you don't write any CSS
- Highlight code blocks with Shiki (via `rehype-pretty-code`), with fence meta on
  the opening ` ```ts ` line for a title (`title="server.ts"`), a line-number gutter
  (`showLineNumbers`), and highlighted lines (`{1,3-4}`) — see `01-markdown.md`
- Support GitHub Flavored Markdown (tables, task lists, strikethrough, etc.) via `remark-gfm`
- Switch between light and dark automatically based on your OS setting
- Let `.mdx` files import and use React 19 components
- Provide a small library of builtin components (like `Callout`) with no import required
- Navigate between folders and docs client-side, with subtle enter/exit motion that
  respects `prefers-reduced-motion`

There is no build step and no config file required to get started.

## Running it

```bash
# Serve the current directory on the default port (4040)
npx mdxserve

# Serve a specific folder
npx mdxserve docs/

# Use a specific port (falls back to a free port automatically if 4040 is taken)
npx mdxserve -p 5000
```

`[dir]` is an optional positional argument; it defaults to the current directory. `-p <port>`
sets the port; if that port is already in use, `mdxserve` picks the next free one and prints
the URL it actually bound to.

## What a directory listing shows

Browsing to a folder shows:

- Subfolders, so you can navigate deeper (see `nested/deep/`)
- `.md` and `.mdx` files, clickable, rendered on click
- Any other files (images, `.txt`, etc.) listed but shown muted/greyed out, since they aren't
  rendered — see `notes.txt` and `assets/logo.png`

## Files in this example

| File | Description |
| --- | --- |
| [`01-markdown.md`](./01-markdown.md) | Plain Markdown tour: headings, text formatting, lists, tables, quotes, links, images, code blocks |
| [`02-mdx-basics.mdx`](./02-mdx-basics.mdx) | Introduces MDX: frontmatter-style exports, inline JSX, and JS expressions inside a document |
| [`03-custom-components.mdx`](./03-custom-components.mdx) | Imports and uses a custom React component (`Counter`), plus the builtin `Callout` |
| [`04-tailwind.mdx`](./04-tailwind.mdx) | Tailwind utility classes inside MDX, dark mode variants, and opting out of `prose` |
| [`components/Counter.tsx`](./components/Counter.tsx) | Example stateful React component used by `03-custom-components.mdx` |
| [`nested/deep/05-nested-page.md`](./nested/deep/05-nested-page.md) | A page two folders deep, to show breadcrumb/folder navigation |
| [`06-builtins.mdx`](./06-builtins.mdx) | Tour of builtin components (`Callout`, `Button`, `Tooltip`, `Tabs`, `Badge`, `Diff`, `Card`, `Kbd`, `FileTree`, `Dropdown`) and the `mdxserve components` CLI |
| [`07-charts.mdx`](./07-charts.mdx) | Data visualization with builtins: `Sparkline` in tables and prose, `Chart` as bar / horizontal bar / grouped bar / line / area / histogram, and one dataset in `Tabs` |
| [`assets/logo.png`](./assets/logo.png) | A small PNG used by `01-markdown.md` to show image rendering |
| [`assets/reader-light.jpg`](./assets/reader-light.jpg) | A screenshot of the reader, framed by `Screenshot` in `06-builtins.mdx` |
| [`notes.txt`](./notes.txt) | A plain text file, to show how non-Markdown files appear in listings |

## Using this as a template for your own docs

Copy this folder (or just start from an empty one) and run `npx mdxserve` inside it. Any `.md`
file works with no setup. If you want interactive components, write a `.tsx` file next to your
`.mdx` file and `import` it — see `03-custom-components.mdx` for the pattern.

Fenced blocks with the `mermaid` language render as diagrams, with a Diagram / Code toggle in the block header.
