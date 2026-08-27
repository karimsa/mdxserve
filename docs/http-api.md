# The HTTP API

Everything the browser UI, the CLI's `roots` / `status` commands, and the stdio MCP bridge need
from a running server goes through one [tRPC](https://trpc.io) router, mounted at
`http://127.0.0.1:<port>/__mdxserve/trpc` (the startup banner prints it as `API:`).

Every method has a zod schema on both its input and its output, and a required description.
Each domain module's `controller.ts` (`src/roots/`, `src/listing/`, `src/search/`,
`src/validation/`, `src/docs/`, `src/trash/`) defines its procedures and schemas;
`src/api/router.ts` aggregates them. The browser and the bridge import the router's
`AppRouter` type, so a change to a method's shape fails to compile on every caller.

## Transport rules

| Request                                      | Response                                                           |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Query                                        | `GET`                                                              |
| Mutation                                     | `POST` with a JSON body                                            |
| `POST` with any other content type           | `415`                                                              |
| Mutation over `GET`                          | `405`                                                              |
| Mutation whose `Origin` doesn't match `Host` | `403` — see [LAN exposure](./advanced.md#exposing-it-on-a-network) |

The request and response encoding is tRPC's; the reference client is the one the CLI and the
stdio bridge use, in `src/servers/`. Reach for that (or any tRPC client pointed at the
`AppRouter` type) before hand-writing requests.

## Methods

| Method             | Kind     | Input                                           | What it is used for                                                                                                                                                                                                                                                 |
| ------------------ | -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listRoots`        | query    | (none)                                          | Returns every currently served root (name, dir). Used by `mdxserve roots list` and the MCP `list_roots` tool.                                                                                                                                                       |
| `addRoots`         | mutation | `{ dirs }`                                      | Serves one or more absolute directories on the running server, live — same-machine callers only. Used by `mdxserve roots add` and the MCP `add_root` tool.                                                                                                          |
| `removeRoots`      | mutation | `{ dirs }`                                      | Stops serving one or more directories, live — same-machine callers only. Used by `mdxserve roots remove` and the MCP `remove_root` tool.                                                                                                                            |
| `getFolderListing` | query    | `{ path }`                                      | Lists the entries (subfolders and `.md`/`.mdx` docs, with titles, sizes, and mtimes) of one folder under a served root. Used by the folder view and the sidebar when a folder is opened or changes on disk.                                                         |
| `getDocTree`       | query    | `{ path?, maxDepth? }`                          | Returns the full doc tree of every served root, or of one directory, up to `maxDepth` levels. Used by the sidebar, `⌘K` search, prev/next navigation, and the MCP `list_docs` tool.                                                                                 |
| `searchDocs`       | query    | `{ query }`                                     | Full-text search across the titles, headings, and bodies of every served doc, ranked, capped at 30 results. Used by the `⌘K` search dialog and the MCP `search_docs` tool; an empty query returns docs in tree order.                                               |
| `moveDocsToTrash`  | mutation | `{ paths }`                                     | Moves the given doc files (never directories) to the OS Trash, so they are recoverable. Used by the folder view's multi-select delete; returns which paths were trashed and which failed, with a reason each.                                                       |
| `validateDoc`      | mutation | `{ path }`                                      | Validates one `.md`/`.mdx` file: MDX compile errors, unknown components/props against the builtin registry, and — for same-machine callers only — a server-side render to catch render-time throws. Used by the MCP `validate_doc` tool.                            |
| `getDocSource`     | query    | `{ path }`                                      | Returns the raw on-disk text of one doc together with its mtime, so the in-place section editor can seed itself from exactly what is on disk and later detect concurrent edits. Used when a section is opened for editing.                                          |
| `saveDocSection`   | mutation | `{ path, startLine, endLine, mtime, markdown }` | Replaces one line range of a doc with edited markdown: the mtime must still match the one the caller read (`CONFLICT` otherwise), the resulting file must validate (`UNPROCESSABLE_CONTENT` otherwise), and the write is atomic. Used by the section editor's Save. |

Paths are absolute, in the same form as the site's URLs (`/Users/you/notes/foo.md`).

## Who may call what

Render-time validation executes the doc's top-level code in a Node worker, so `validateDoc`
only runs it for callers on the same machine — loopback, or the stdio bridge connecting to the
address the server registered. Anyone else on the LAN gets the static checks with
`rendered: false`. `addRoots` and `removeRoots` are loopback-only outright: a caller elsewhere
on the LAN gets `FORBIDDEN` rather than a degraded response.

## The MCP endpoint

The same server mounts its MCP tools over Streamable HTTP at `/__mdxserve/mcp`. Those tools
are thin wrappers over the methods above — a tool and a procedure call the same service, so
they cannot drift. See [the MCP server](./advanced.md#the-mcp-server).
