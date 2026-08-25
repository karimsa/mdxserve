# mdxserve

`npx serve`, but for Markdown/MDX.

Point it at a directory and it serves a Notion-like listing of your `.md`/`.mdx`
files. Clicking a file renders it in the browser through Vite — so plain
Markdown just renders, and any JSX or components you `import` in an `.mdx`
file work too, with Tailwind available everywhere and Vite HMR while you edit.

![A rendered Markdown page in the light theme: sidebar file tree, prose column, table of contents](docs/screenshots/reader-light.jpg)

![The same page in the dark theme](docs/screenshots/reader-dark.jpg)

## Install

From a fresh clone:

```bash
./setup.sh
```

This runs `yarn install`, `yarn build`, links `mdxserve` onto your `PATH` with
`npm link`, and registers the skills in `./skills` with Claude Code, Codex, and
`~/.agents/skills` via `npx skills add`. Re-run it after editing `./skills`.

## Usage

```bash
npx mdxserve [dir]           # serve `dir` (defaults to the current directory)
npx mdxserve -p 5000 [dir]   # pick a port (default 4040; falls back to a free port if taken)
npx mdxserve --host 0.0.0.0 [dir]  # expose on the LAN (default binds to 127.0.0.1 only)
npx mdxserve -w ~/notes -w ~/work/docs  # serve several unrelated folders at once
npx mdxserve docs -w ~/notes            # [dir] is shorthand for one more `-w` root
```

Then open the printed URL — with a single root it redirects straight to that
folder's listing; with more than one, `/` lists the mounted roots. URLs mirror
the absolute filesystem path (`~/notes/foo.md` is served at
`/Users/you/notes/foo.md`), and anything outside a mounted root 404s. Folders
always show a listing; `.md`/`.mdx` files render as pages. Everything else in
a directory is listed too, muted and unclickable, so you can see what's there.

### Running in the background

`mdxserve` has no daemon mode of its own: `mdxserve serve` runs in the foreground until you
stop it. If you want it to keep running after you close the terminal, that's optional and
entirely up to you — any process manager works. [oxmgr](https://github.com/Vladimir-Urik/OxMgr) is
one option:

```bash
oxmgr start "mdxserve -w ~/notes"

oxmgr logs mdxserve      # tail the server log
oxmgr stop mdxserve      # stop it (keeps the registration)
oxmgr delete mdxserve    # stop and forget it
```

## Writing docs

- `.md` and `.mdx` are treated identically: GitHub-flavored Markdown (tables, task lists, etc.)
  with syntax-highlighted code blocks.
- Any file can `import` React components (`.tsx`/`.jsx`) and use them
  directly as JSX. Components are resolved relative to the MDX file, exactly
  like any other Vite/ESM import — no magic auto-registration.
- Tailwind utility classes work anywhere in your MDX/JSX.

See [`example/`](./example) for a working tour of all of this — run it with:

```bash
yarn dev   # runs `mdxserve example`
```

## Reading

Every page sits in the same shell: a sidebar listing the current document's folder, the rendered
document in a 44rem column, and a table of contents that tracks the heading you are
reading. The topbar has search (`⌘K` / `Ctrl K`), a light/dark toggle that remembers
your choice, and print. Pages link to their previous and next neighbour and name the
source file and when it was last edited.

Mermaid fences render as pan-and-zoom diagrams themed to match, with a Diagram/Code
toggle; code blocks carry a language or filename label and a copy button.

![Mermaid diagrams rendered in the dark theme](docs/screenshots/diagrams-dark.jpg)

## Navigation and motion

The whole site is one client-side app: clicking into a folder or a `.md`/`.mdx` file
navigates without a full page reload, with a subtle enter/exit fade between views
(listing rows stagger in, docs cross-fade, the browser back/forward buttons work as
expected). In-page links scroll smoothly. Everything respects `prefers-reduced-motion` —
turn it on and the transforms drop out while views still swap.

Links to anything else (images, `.txt` files, other sites) are left alone and behave
like normal `<a href>` navigation.

## Builtin components

![Chart, Sparkline and Dropdown builtins in the light theme](docs/screenshots/builtins-light.jpg)

`mdxserve` ships a small library of components that are available in every `.mdx` file with
no `import` needed:

- `Callout` — a boxed aside with an icon, for notes, tips, and warnings
- `Button` — a link/button with variants, sizes, and a small tap animation
- `Tooltip` — a hover/focus tooltip (via tippy.js) for inline content
- `Tabs` / `Tab` — a tabbed container that cross-fades between panels
- `Badge` — a small inline pill for a status, tag, or label
- `Diff` — a before/after code diff with unified or side-by-side views
- `Card` / `CardGrid` — a bordered content card, with a responsive grid to lay several out
- `Kbd` — a small styled key cap for keyboard shortcuts
- `FileTree` — a collapsible file/folder tree
- `Chart` — a bar/line/area chart rendered as inline SVG
- `Sparkline` — a tiny inline trend line

```mdx
<Callout tone="warn" title="Heads up">
	Some caveat worth calling out.
</Callout>

<Tabs>
	<Tab label="npm">Run `npm install`.</Tab>
	<Tab label="yarn">Run `yarn install`.</Tab>
</Tabs>
```

A local `import` of a component with the same name always takes priority over a builtin.
Each builtin's props are defined with a `zod` schema, which doubles as a JSON Schema registry
you can query from the CLI (useful for humans and for AI agents writing docs):

```bash
mdxserve components search            # list every builtin component
mdxserve components search callout    # search by name, description, or prop
mdxserve components show Callout      # full details, including a props table
mdxserve components show Callout --json
```

The registry is generated by `yarn build`; see `example/06-builtins.mdx` for a live demo.

## MCP server

The easiest way to reach mdxserve's tools is the stdio bridge: `mdxserve mcp`. It doesn't
serve anything itself — instead it discovers every currently-running `mdxserve serve` and
answers tool calls across all of them. `./setup.sh` registers it automatically (as `mdxserve`,
with `claude mcp add -s user` and/or `codex mcp add`, whichever CLIs are present); pass
`--no-mcp` to skip that. For any other client, point it at the repo's `mcp.json`
(`{ "mcpServers": { "mdxserve": { "command": "mdxserve", "args": ["mcp"] } } }`).

Discovery works because every `mdxserve serve` registers itself (port, pid, roots) in
`~/.mdxserve/servers.db` on startup and unregisters on a clean shutdown; a stale row from a
crash is pruned automatically by checking its pid. The bridge then talks to those servers
over their HTTP API (a tRPC client, see below): `list_docs` and `search_docs` ask every live
server and merge the answers, and `validate_doc` asks whichever server owns the path. With no
server running, `validate_doc` still accepts an absolute path and runs the static checks
locally — handy for validating a doc before a server is even started.

| Tool              | Input                  | What it does                                                                                                           |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `validate_doc`    | `{ path }`             | Compiles a `.md`/`.mdx` file and reports MDX compile errors, unknown components, unknown props, and render-time errors |
| `list_components` | `{ query? }`           | Same as `mdxserve components search`                                                                                   |
| `show_component`  | `{ name }`             | Same as `mdxserve components show`                                                                                     |
| `search_docs`     | `{ query }`            | The `⌘K` search                                                                                                        |
| `list_docs`       | `{ path?, maxDepth? }` | The doc tree of every served root, or of one directory                                                                 |

Paths are absolute, in the same form as the site's URLs (`/Users/you/notes/foo.md`);
`validate_doc` also takes a root-relative path when exactly one served root contains it.

`validate_doc`'s result also carries a `rendered` flag alongside `ok`: whenever a live
`mdxserve serve` owns the path (in HTTP mode, or proxied from the stdio bridge through the
`validateDoc` API method), the tool actually renders the doc server-side and reports any
throw as a `render-error` diagnostic — this is what catches a component that compiles fine but
blanks the page at render time. `rendered: false` means no live server was available, so only
the static checks ran. Even when `rendered: true`, errors thrown inside a
`useEffect`/`useLayoutEffect` and hydration mismatches are never caught — those stay
browser-only.

### HTTP, per instance

`mdxserve serve` also mounts the same MCP server (Streamable HTTP, stateless, read-only
tools) directly at `http://127.0.0.1:<port>/__mdxserve/mcp` — useful when you want to talk to
one specific instance rather than every running server:

```bash
claude mcp add --transport http mdxserve http://127.0.0.1:4040/__mdxserve/mcp
```

The port must match `-p` — the startup banner prints the exact URL to use. With
`--host 0.0.0.0`, anyone on the LAN can call these tools too, same as the HTTP API below;
unlike `moveDocsToTrash`, the MCP tools are read-only.

## HTTP API

Everything the browser UI and the stdio MCP bridge need from a running server goes through one
[tRPC](https://trpc.io) router, mounted at `http://127.0.0.1:<port>/__mdxserve/trpc` (the
banner prints it as `API:`). Every method has a zod schema on both its input and its output, and
a required description; each domain module's `controller.ts` (`src/listing/`, `src/search/`,
`src/validation/`, `src/docs/`, `src/trash/`) defines its procedures and schemas, `src/api/router.ts`
aggregates them, and the browser and the bridge import its `AppRouter` type, so a change to a method's shape fails to compile on every caller.
Queries are `GET`, mutations are `POST` with a JSON body (a `POST` with any other content type
is rejected with 415, and a mutation over `GET` with 405). Mutations are write surfaces, so a
request carrying an `Origin` header that doesn't match the `Host` it arrived on is rejected
with 403 — a page on another origin can't reach them even when the server is bound to
`0.0.0.0`.

| Method             | Kind     | Input                                           | What it is used for                                                                                                                                                                                                                                                 |
| ------------------ | -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getFolderListing` | query    | `{ path }`                                      | Lists the entries (subfolders and `.md`/`.mdx` docs, with titles, sizes, and mtimes) of one folder under a served root. Used by the folder view and the sidebar when a folder is opened or changes on disk.                                                         |
| `getDocTree`       | query    | `{ path?, maxDepth? }`                          | Returns the full doc tree of every served root, or of one directory, up to `maxDepth` levels. Used by the sidebar, `⌘K` search, prev/next navigation, and the MCP `list_docs` tool.                                                                                 |
| `searchDocs`       | query    | `{ query }`                                     | Full-text search across the titles, headings, and bodies of every served doc, ranked, capped at 30 results. Used by the `⌘K` search dialog and the MCP `search_docs` tool; an empty query returns docs in tree order.                                               |
| `moveDocsToTrash`  | mutation | `{ paths }`                                     | Moves the given doc files (never directories) to the OS Trash, so they are recoverable. Used by the folder view's multi-select delete; returns which paths were trashed and which failed, with a reason each.                                                       |
| `validateDoc`      | mutation | `{ path }`                                      | Validates one `.md`/`.mdx` file: MDX compile errors, unknown components/props against the builtin registry, and — for same-machine callers only — a server-side render to catch render-time throws. Used by the MCP `validate_doc` tool.                            |
| `getDocSource`     | query    | `{ path }`                                      | Returns the raw on-disk text of one doc together with its mtime, so the in-place section editor can seed itself from exactly what is on disk and later detect concurrent edits. Used when a section is opened for editing.                                          |
| `saveDocSection`   | mutation | `{ path, startLine, endLine, mtime, markdown }` | Replaces one line range of a doc with edited markdown: the mtime must still match the one the caller read (`CONFLICT` otherwise), the resulting file must validate (`UNPROCESSABLE_CONTENT` otherwise), and the write is atomic. Used by the section editor's Save. |

Render-time validation executes the doc's top-level code in a Node worker, so `validateDoc` only
runs it for callers on the same machine (loopback, or the stdio bridge connecting to the address
the server registered); anyone else on the LAN gets the static checks with `rendered: false`.

## Agent skill

`skills/mdxserve/SKILL.md` teaches an AI agent how to write Markdown that renders well here
while staying portable, and how to discover the builtin components with
`mdxserve components search`. It prefers the MCP tools (`list_components`, `show_component`,
`validate_doc`) when the mdxserve MCP server is connected, and falls back to the CLI
otherwise. `./setup.sh` installs the skill (via `npx skills add`) for Claude Code, Codex,
and `~/.agents/skills`; re-run it after editing anything under `skills/`.

## Cache

Vite pre-bundles the browser dependencies (React, mermaid, framer-motion, …)
on first start and keeps that cache under `~/.cache/mdxserve/` (or
`$XDG_CACHE_HOME/mdxserve/`), in a folder named after the first root you pass
(the first `-w`, or `[dir]` if you didn't pass `-w`) plus a hash of its
absolute path, e.g. `~/.cache/mdxserve/docs-3f9a1c2b7d4e5f60/`. Later starts
are fast and nothing is written inside your docs folders. It is safe to
delete at any time. Set `MDXSERVE_CACHE_HOME` to move the whole cache
elsewhere.

```bash
npx mdxserve cache clean          # remove the cache for ./
npx mdxserve cache clean docs/    # remove the cache for docs/
```

## Development

Fresh clone: `./setup.sh` installs dependencies, builds, installs a `mdxserve` launcher in `~/.local/bin` (or `/usr/local/bin`),
and installs the agent skill. Day to day:

```bash
yarn typecheck
yarn build   # generates dist/registry.json, then bundles src/index.ts -> dist/cli.js
```
