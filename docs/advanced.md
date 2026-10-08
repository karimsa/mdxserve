# mdxserve for power users

The [README](../README.md) gets you serving a folder. This page is what sits underneath: how
the single server is found and shared, what the rules for roots and URLs are, what changes
when you expose it on a network, and the full story on exports, the agent CLI, and the cache.

## One server per user

Only one `mdxserve serve` runs per user at a time. On start it takes a pid lockfile at
`~/.mdxserve/server.lock` and writes its record — pid, port, host, and the roots it serves —
to `~/.mdxserve/servers.db` (sqlite). Every other command finds the server through that
record:

| Command                                | Talks to the running server?          |
| -------------------------------------- | ------------------------------------- |
| `mdxserve roots add \| remove \| list` | Yes, over its HTTP API                |
| `mdxserve status`                      | Yes; exits 1 when nothing is running  |
| `mdxserve validate`                    | When one is running; else static only |
| `mdxserve search \| docs`              | Yes; exit 1 when nothing is running   |
| `mdxserve export`                      | No — it renders on its own            |
| `mdxserve components …`                | No — reads the built registry         |

A second `serve` exits with an error naming the running instance's URL and pointing you at
`roots add` or `status`. A stale lock left by a crashed process is detected by pid and taken
over automatically; a stale row in `servers.db` is pruned the same way.

Roots persist in `~/.mdxserve/config.json` (or `$MDXSERVE_HOME/config.json`).
The `roots` array contains directory paths; `~` expands to your home and relative paths
resolve against the config directory. `serve` restores this list and adds any `-w` paths.
Root commands update the file. You can edit it yourself while the server is running or
stopped; a running server reloads valid changes automatically. Set `roots` to `[]` to
unmount everything. Invalid edits or a deleted config keep the last working roots active
and log an error; correcting the file resumes reloading. Invalid startup configuration
prevents startup.

Set `MDXSERVE_HOME` to move the lock and database somewhere else — useful for running a
throwaway instance side by side with your real one, since each home has its own server.

## Roots and URLs

A path given to `-w` or `roots add` is resolved against the current directory (`~` expands),
then checked by the server. It refuses a path that:

- does not exist, or is not a directory
- is `/`
- is already served, or is nested inside (or contains) a served root

URLs mirror the absolute filesystem path: `~/notes/foo.md` is served at
`/Users/you/notes/foo.md`. Anything outside a served root is a 404. The CLI verbs and the
HTTP API use the same absolute-path form.

What `/` shows depends on how many roots there are:

| Roots | `/`                                                                              |
| ----- | -------------------------------------------------------------------------------- |
| 0     | An empty state pointing at `mdxserve roots add`; updates live as roots are added |
| 1     | Redirects straight to that folder's listing                                      |
| 2+    | A list of the served roots                                                       |

Folders always show a listing. `.md` / `.mdx` files render as pages. Everything else in a
folder is listed too, muted and unclickable, so you can see what is there.

## Exposing it on a network

The server binds to `127.0.0.1` by default. `--host 0.0.0.0` makes it reachable from other
machines on your LAN, and most of it works the same for them — reading and search. Three things are held back for callers that are not on the same machine:

| Capability                                                  | Loopback caller          | Remote caller                                                          |
| ----------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| Render-time validation (`mdxserve validate`, `validateDoc`) | Runs the doc in a worker | Static checks only, `rendered: false`                                  |
| `mdxserve roots add \| remove`, `addRoots` / `removeRoots`  | Allowed                  | `FORBIDDEN`                                                            |
| Any mutation                                                | Allowed                  | Rejected with 403 when the request's `Origin` doesn't match its `Host` |

The `Origin` check means a page on another site cannot drive the write endpoints even when
the server is bound to `0.0.0.0`. The section editor and the Trash action are mutations too,
so they follow the same rule.

One more thing a remote caller can reach: the dev server serves the files of mdxserve's own
dependencies under `/@fs/`, from the `node_modules` the package was installed into. With a
global or `npx` install that folder also holds whatever else is installed there, so bind to
`0.0.0.0` only on a network you trust.

## Exporting

`mdxserve export <file>` compiles one document into one self-contained HTML file. It never
touches a running server, so it works with nothing else up.

```bash
mdxserve export docs/guide.md                        # writes ./guide.html
mdxserve export docs/guide.md -o ~/Desktop/guide.html
mdxserve export docs/guide.md -f html                # html is the only format today
mdxserve export docs/guide.md --mermaid bundle       # inline mermaid for a fully offline file
```

What the file carries:

- The same theme, fonts, code blocks, builtin components, table of contents, and page-width
  controls as the live viewer
- Relative images, inlined
- Custom components the document imports, compiled in
- The lucide icons the document names literally

What it does not:

- The sidebar, search, previous/next links, editing, and live reload — everything that needs
  a server
- Links to other `.md` files, which stay plain links
- An icon whose name is assembled at runtime rather than written in the document

Mermaid comes from a CDN on first open by default (`--mermaid cdn`), pinned to the version
mdxserve ships, so a typical page stays under 1 MB. `--mermaid bundle` inlines it (about
2.4 MB more) for a file that must work with no network; `--mermaid none` drops diagrams.

The viewer's Export menu (same-machine browsers only) produces the same output through the
browser's save dialog, always with mermaid from the CDN.

## The agent CLI

Every verb below is a thin client of the running server's HTTP API (except where noted), and
each takes `--json` for scripting. Paths are absolute, in the same form as the site's URLs.

### Verbs

| Verb                                   | What it does                                                                                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mdxserve validate <paths...>`         | Compiles each `.md`/`.mdx` file and reports MDX compile errors, unknown components, unknown props, mermaid chart fences (`pie`/`xychart-beta`/`quadrantChart`/`sankey-beta` — use `<Chart>` instead), and render-time errors. Exits 1 on any error |
| `mdxserve search <query>`              | The `⌘K` search: one `<path> — <title>` line per match, with an excerpt                                                                                                                                                                            |
| `mdxserve docs [dir] [--depth n]`      | The doc tree of every served root, or of one directory                                                                                                                                                                                             |
| `mdxserve roots list \| add \| remove` | Every served root; serves or stops serving absolute directories on the running server                                                                                                                                                              |
| `mdxserve components search [q]`       | Lists the builtin components, filtered by name, description, or prop name                                                                                                                                                                          |
| `mdxserve components show <name>`      | Props table (types, defaults) and when to use a builtin                                                                                                                                                                                            |

### What happens with no server, or no roots

| State                    | `search`, `docs`                                                                                            | `validate`                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| No server running        | "No mdxserve server is running; start one with `mdxserve serve -w <dir>`", exit 1                           | Static checks only, then `Not rendered (no mdxserve server is reachable; …)` |
| Server running, no roots | "The mdxserve server is running but serves no folders yet; add one with `mdxserve roots add <dir>`", exit 1 | Absolute path works fully                                                    |

### `mdxserve validate` and `rendered`

The `--json` result carries `rendered` next to `ok`; the text output prints `Rendered OK` or
`Not rendered (…)`. When a live server owns the path and the caller
is on the same machine, the doc is rendered server-side in a worker thread and any throw comes
back as a `render-error` diagnostic — this catches a component that compiles fine but blanks
the page. `rendered: false` means only the static checks ran (compile, unknown component,
unknown prop, mermaid chart fence). Even with `rendered: true`, errors thrown inside `useEffect` /
`useLayoutEffect` and hydration mismatches are never caught; those stay browser-only.

A `pie`, `xychart-beta`, `quadrantChart`, or `sankey-beta` mermaid fence is always an `error`
diagnostic with code `mermaid-chart` — mdxserve doesn't render these, so the doc should use the
builtin `<Chart>` component (bar, line, area, histogram) or a table instead. Every other mermaid
diagram (flow, sequence, class, state, ER, gantt, timeline, gitGraph, mindmap, journey, …) is
unaffected.

The result also carries `hints`: an array of advisory strings that never affect `ok`. Today
there is one — a Markdown image whose alt text or path mentions "screen" is probably a
screenshot, and the hint points the agent at the builtin `<Screenshot>` component, which frames
it as a macOS window with an expand view. The text output prints each as a `hint:` line after
the render status.

## The agent skill

`skills/mdxserve/SKILL.md` teaches an agent how to write Markdown that renders well here while
staying portable: prefer plain GFM, tag every code fence, keep diagrams small, use a builtin
only when it clarifies, and validate the file afterwards. It points the agent at
`mdxserve components` and `mdxserve validate`. `mdxserve setup` installs it with
`npx skills add` for Claude Code, Codex, and `~/.agents/skills`; re-run `mdxserve setup` after
upgrading (or, in a checkout, after editing anything under `skills/`), since the skills CLI
copies rather than symlinks.

## The cache

Vite pre-bundles the browser dependencies (React, mermaid, framer-motion, …) on first start
and keeps that under `~/.cache/mdxserve/vite/` (or `$XDG_CACHE_HOME/mdxserve/vite/`). One
server, one cache: later starts are fast, and nothing is ever written inside your docs
folders. It is safe to delete at any time.

```bash
mdxserve cache clean          # remove the whole cache; the next serve rebuilds it
```

## Environment variables

| Variable              | Default             | Controls                                                   |
| --------------------- | ------------------- | ---------------------------------------------------------- |
| `MDXSERVE_HOME`       | `~/.mdxserve`       | Where the server lock and `servers.db` live                |
| `MDXSERVE_CACHE_HOME` | `~/.cache/mdxserve` | Where the Vite dependency cache lives                      |
| `XDG_CACHE_HOME`      | `~/.cache`          | Honoured for the cache when `MDXSERVE_CACHE_HOME` is unset |
