# mdxserve for power users

The [README](../README.md) gets you serving a folder. This page is what sits underneath: how
the single server is found and shared, what the rules for roots and URLs are, what changes
when you expose it on a network, and the full story on exports, the MCP server, and the cache.

## One server per user

Only one `mdxserve serve` runs per user at a time. On start it takes a pid lockfile at
`~/.mdxserve/server.lock` and writes its record — pid, port, host, and the roots it serves —
to `~/.mdxserve/servers.db` (sqlite). Every other command finds the server through that
record:

| Command                                | Talks to the running server?         |
| -------------------------------------- | ------------------------------------ |
| `mdxserve roots add \| remove \| list` | Yes, over its HTTP API               |
| `mdxserve status`                      | Yes; exits 1 when nothing is running |
| `mdxserve mcp`                         | Yes, proxies every tool call to it   |
| `mdxserve export`                      | No — it renders on its own           |
| `mdxserve components …`                | No — reads the built registry        |

A second `serve` exits with an error naming the running instance's URL and pointing you at
`roots add` or `status`. A stale lock left by a crashed process is detected by pid and taken
over automatically; a stale row in `servers.db` is pruned the same way.

Roots are running state. They last until the server stops, and a fresh `serve` starts with
only the folders named on its command line (none, if no `-w`).

Set `MDXSERVE_HOME` to move the lock and database somewhere else — useful for running a
throwaway instance side by side with your real one, since each home has its own server.

## Roots and URLs

A path given to `-w` or `roots add` is resolved against the current directory (`~` expands),
then checked by the server. It refuses a path that:

- does not exist, or is not a directory
- is `/`
- is already served, or is nested inside (or contains) a served root

URLs mirror the absolute filesystem path: `~/notes/foo.md` is served at
`/Users/you/notes/foo.md`. Anything outside a served root is a 404. The MCP tools and the
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
machines on your LAN, and most of it works the same for them — reading, search, the MCP
tools over HTTP. Three things are held back for callers that are not on the same machine:

| Capability                                             | Loopback caller          | Remote caller                                                          |
| ------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------- |
| Render-time validation (`validate_doc`, `validateDoc`) | Runs the doc in a worker | Static checks only, `rendered: false`                                  |
| `add_root` / `remove_root`, `addRoots` / `removeRoots` | Allowed                  | `FORBIDDEN`                                                            |
| Any mutation                                           | Allowed                  | Rejected with 403 when the request's `Origin` doesn't match its `Host` |

The `Origin` check means a page on another site cannot drive the write endpoints even when
the server is bound to `0.0.0.0`. The section editor and the Trash action are mutations too,
so they follow the same rule.

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

## The MCP server

There are two ways to reach the tools.

### Over stdio: `mdxserve mcp`

The stdio bridge is what `setup.sh` registers with Claude Code (`claude mcp add -s user`) and
Codex (`codex mcp add`). It serves nothing itself: it reads `~/.mdxserve/servers.db`, finds
the running server, and proxies each tool call to it over the HTTP API. For any other client,
the repo's `mcp.json` is the config:

```json
{ "mcpServers": { "mdxserve": { "command": "mdxserve", "args": ["mcp"] } } }
```

### Over HTTP

`mdxserve serve` also mounts the same MCP server (Streamable HTTP, stateless) at
`http://127.0.0.1:<port>/__mdxserve/mcp`; the startup banner prints the exact URL.

```bash
claude mcp add --transport http mdxserve http://127.0.0.1:4040/__mdxserve/mcp
```

With `--host 0.0.0.0` this is reachable from the LAN, subject to the loopback rules above.

### Tools

| Tool              | Input                  | What it does                                                                                                           |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `validate_doc`    | `{ path }`             | Compiles a `.md`/`.mdx` file and reports MDX compile errors, unknown components, unknown props, and render-time errors |
| `list_components` | `{ query? }`           | Same as `mdxserve components search`                                                                                   |
| `show_component`  | `{ name }`             | Same as `mdxserve components show`                                                                                     |
| `search_docs`     | `{ query }`            | The `⌘K` search                                                                                                        |
| `list_docs`       | `{ path?, maxDepth? }` | The doc tree of every served root, or of one directory                                                                 |
| `list_roots`      | `{}`                   | Every currently served root                                                                                            |
| `add_root`        | `{ path }`             | Serves an absolute directory on the running server                                                                     |
| `remove_root`     | `{ path }`             | Stops serving a directory                                                                                              |

Paths are absolute, in the same form as the site's URLs. `validate_doc` also accepts a
root-relative path when exactly one served root contains it.

### What happens with no server, or no roots

| State                    | `list_docs`, `search_docs`, `list_roots`, `add_root`                                                                   | `validate_doc`                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| No server running        | "No mdxserve server is running; start one with `mdxserve serve -w <dir>`"                                              | Absolute path: static checks only, `rendered: false`. Relative path: the same error |
| Server running, no roots | `list_docs` / `search_docs` say nothing is served yet and point at `add_root`; `list_roots` is empty; `add_root` works | Absolute path works fully; relative path says nothing is served                     |

### `validate_doc` and `rendered`

The result carries `rendered` next to `ok`. When a live server owns the path and the caller
is on the same machine, the doc is rendered server-side in a worker thread and any throw comes
back as a `render-error` diagnostic — this catches a component that compiles fine but blanks
the page. `rendered: false` means only the static checks ran (compile, unknown component,
unknown prop). Even with `rendered: true`, errors thrown inside `useEffect` /
`useLayoutEffect` and hydration mismatches are never caught; those stay browser-only.

## The agent skill

`skills/mdxserve/SKILL.md` teaches an agent how to write Markdown that renders well here while
staying portable: prefer plain GFM, tag every code fence, keep diagrams small, use a builtin
only when it clarifies, and validate the file afterwards. It prefers the MCP tools
(`list_components`, `show_component`, `validate_doc`) when the server is connected and falls
back to the `mdxserve components` CLI otherwise. `setup.sh` installs it with
`npx skills add` for Claude Code, Codex, and `~/.agents/skills`; re-run `setup.sh` after
editing anything under `skills/`, since the skills CLI copies rather than symlinks.

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
