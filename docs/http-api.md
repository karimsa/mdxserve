# The HTTP API

Everything the browser UI, and the CLI need
from a running server goes through one [tRPC](https://trpc.io) router, mounted at
`http://127.0.0.1:<port>/__mdxserve/trpc` (the startup banner prints it as `API:`).

Every method has a zod schema on both its input and its output, and a required description.
Each domain module's `controller.ts` in `packages/server/src/` (`roots/`, `listing/`,
`search/`, `validation/`, `docs/`, `trash/`) defines its procedures and schemas;
`packages/server/src/api/router.ts` aggregates them. The browser and the bridge import the router's
`AppRouter` type, so a change to a method's shape fails to compile on every caller.

## Transport rules

| Request                                         | Response                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| Query                                           | `GET`                                                              |
| Mutation                                        | `POST` with a JSON body                                            |
| `POST` with any other content type              | `415`                                                              |
| Mutation over `GET`                             | `405`                                                              |
| Mutation whose `Origin` doesn't match `Host`    | `403` — see [LAN exposure](./advanced.md#exposing-it-on-a-network) |
| Any mutation in `--permissions restricted` mode | `403`, including calls from loopback or a reverse proxy            |

The request and response encoding is tRPC's; the reference client is the one the CLI and the
stdio bridge use, in `packages/server/src/servers/`. Reach for that (or any tRPC client pointed at the
`AppRouter` type) before hand-writing requests.

In `--permissions restricted` mode, queries for the reader, tree, search, components, and document source
remain available. Diagram preferences and every mutation are blocked. The restricted policy is
set at server startup, so a reverse proxy's local upstream connection cannot grant write or
server-side execution privileges.

## Methods

| Method                     | Kind     | Input                                 | What it is used for                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listRoots`                | query    | (none)                                | Returns every currently served root (name, dir). Used by `mdxserve roots list`.                                                                                                                                                                                                                                                                                                                                                               |
| `addRoots`                 | mutation | `{ dirs }`                            | Serves one or more absolute directories on the running server, live — same-machine callers only. Used by `mdxserve roots add`.                                                                                                                                                                                                                                                                                                                |
| `removeRoots`              | mutation | `{ dirs }`                            | Stops serving one or more directories, live — same-machine callers only. Used by `mdxserve roots remove`.                                                                                                                                                                                                                                                                                                                                     |
| `getServerInfo`            | query    | (none)                                | Returns the server's `id` (written once to `config.json`), `name` (`--name`, or the hostname), mdxserve `version`, `permissions`, `mermaidVersion`, `treeSchemaVersion` and `tailnetUrls` (the `https://` origins `tailscale serve` publishes it under). Never a mounted folder's name or path. Available in restricted mode and to any caller. Used by the app to identify a server and to check that an address still reaches the same one. |
| `getFolderListing`         | query    | `{ path }`                            | Lists the entries (subfolders and `.md`/`.mdx` docs, with titles, sizes, and mtimes) of one folder under a served root. Used by the folder view and the sidebar when a folder is opened or changes on disk.                                                                                                                                                                                                                                   |
| `getDocTree`               | query    | `{ path?, maxDepth? }`                | Returns the full doc tree of every served root, or of one directory, up to `maxDepth` levels. Used by the sidebar, `⌘K` search, prev/next navigation, and `mdxserve docs`.                                                                                                                                                                                                                                                                    |
| `searchDocs`               | query    | `{ query }`                           | Full-text search across the titles, headings, and bodies of every served doc, ranked, capped at 30 results. Each result carries `targetId`, the id of the innermost section or tab that holds the matching line (or `null`), which the `⌘K` dialog opens the page at. Used by the `⌘K` search dialog and `mdxserve search`; an empty query returns docs in tree order.                                                                        |
| `moveDocsToTrash`          | mutation | `{ paths }`                           | Moves the given doc files (never directories) to the OS Trash, so they are recoverable. Used by the folder view's multi-select delete; returns which paths were trashed and which failed, with a reason each.                                                                                                                                                                                                                                 |
| `validateDoc`              | mutation | `{ path }`                            | Validates one `.md`/`.mdx` file statically, with the parser that builds the document tree: syntax per section, the document rules, unknown components and props, prop values, ids, mermaid fences that draw charts (`pie`, `xychart-beta`, `quadrantChart`, `sankey-beta` — use `<Chart>` instead) and comments. Returns `ok`, `diagnostics` and `hints`.                                                                                     |
| `getDocument`              | query    | `{ path }`                            | Returns one doc parsed into its JSON document tree (`schemaVersion`, `metadata`, `toc`, and block and inline nodes with stable ids) and the `version` token of the bytes it was parsed from. Nothing in it is executable, so it needs no same-machine connection; restricted mode applies the same path rules as `getNodeSource`. `NOT_FOUND` for a path outside the roots, `PAYLOAD_TOO_LARGE` above 2 MiB. Used by `mdxserve document`.     |
| `getNodeSource`            | query    | `{ path, id }`                        | Returns the source lines of one editable node of the document tree (a section, the content before the first heading, a mermaid block, a block builtin, a tab) by its id, with the version token of the file. `NOT_FOUND` for an unknown path or id. Used when the section, diagram or builtin editor opens.                                                                                                                                   |
| `saveDocNode`              | mutation | `{ path, id, version, markdown }`     | Replaces the lines of node `id` with edited markdown. `CONFLICT` when the file no longer has `version`; `NOT_FOUND` when the id is not in the document; `UNPROCESSABLE_CONTENT` when the result has a validation error the file did not already have (an error that was there before the edit does not block it). The write is atomic. Used by the editors' Save.                                                                             |
| `getDocComments`           | query    | `{ path }`                            | Returns the comment threads stored in one doc's frontmatter, with `diagnostics` for entries that failed the schema. Available in restricted mode. Used by the comments panel.                                                                                                                                                                                                                                                                 |
| `addCommentThread`         | mutation | `{ path, anchor, body }`              | Starts a thread on the anchored text, with one human message. Returns the doc's threads and the new `threadId`. Used by the selection comment button.                                                                                                                                                                                                                                                                                         |
| `addCommentReply`          | mutation | `{ path, threadId, body }`            | Appends a human message to a thread. Returns the doc's threads. Used by the thread's reply box.                                                                                                                                                                                                                                                                                                                                               |
| `editComment`              | mutation | `{ path, threadId, messageId, body }` | Changes the text of a human message and sets its `editedAt`; an agent's message is `FORBIDDEN`. Returns the doc's threads. Used by a message's Edit action.                                                                                                                                                                                                                                                                                   |
| `setCommentThreadResolved` | mutation | `{ path, threadId, resolved }`        | Resolves or reopens a whole thread. Returns the doc's threads. Used by Resolve and Reopen.                                                                                                                                                                                                                                                                                                                                                    |

Paths are absolute, in the same form as the site's URLs (`/Users/you/notes/foo.md`).

## Files: `getAsset`

`getAsset` is not a tRPC method, because its result is a file's bytes. It is a plain HTTP
endpoint, `GET /__mdxserve/getAsset?path=<absolute path>`, and it is how a page loads an
image or other non-document file that sits in a mounted root. `path` is required, absolute,
and at most 4096 characters; other query parameters are ignored. `HEAD` works too, and any
other method gets `405`. The query is validated by `getAssetInputSchema` in `packages/server/src/http/asset.ts`.

| Request                                                        | Response                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| Missing, empty or relative `path`                              | `400` with the reason                                       |
| `Origin` that does not match `Host`                            | `403`                                                       |
| A path outside every root, a missing file, or a non-file       | `404`                                                       |
| A `.md` or `.mdx` file (read documents with `getDocument`)     | `404`                                                       |
| Anything under `.git`, `.env` files, `.pem` and `.crt` keys    | `404`                                                       |
| A symlink that leaves its root                                 | `404`                                                       |
| `--permissions restricted`: a hidden or `node_modules` segment | `404`                                                       |
| Anything else                                                  | `200` with the bytes, or `304` when `If-None-Match` matches |

A successful response sets these headers:

- `Content-Type`, from the file's extension.
- `Cache-Control: no-cache`, so a browser revalidates and gets a `304` when the file did not change.
- A weak `ETag` and `Last-Modified`.
- `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`.
- `Content-Security-Policy: sandbox`, for types that can run script in a page (SVG, HTML and XML).

## Who may call what

`addRoots` and `removeRoots` are loopback-only: a caller elsewhere on the LAN gets `FORBIDDEN`.

The comment mutations (`addCommentThread`, `addCommentReply`, `editComment`,
`setCommentThreadResolved`) are open to the same callers as `saveDocNode` and are rejected on
restricted servers. `getDocComments` is a query and works in restricted mode. A comment write
that cannot be applied returns `NOT_FOUND` (doc, thread or message missing),
`UNPROCESSABLE_CONTENT` (the frontmatter is not valid YAML), `PAYLOAD_TOO_LARGE` (the frontmatter
would pass 64 KiB), or `CONFLICT` (the file kept changing during the write).

## Live updates

A browser tab learns that something changed on disk over one [socket.io](https://socket.io)
connection at the path `/__mdxserve/socket.io` (`REALTIME_PATH` in `packages/shared/realtime.ts`). It
shares the server's port with the API.

The server sends three signals, none with a payload. Each one means "what you hold may be
stale", and a client refetches through the API when it gets one:

| Event             | Sent to                                 | When                                                  |
| ----------------- | --------------------------------------- | ----------------------------------------------------- |
| `doc-changed`     | Connections that joined that doc's room | A doc's file changed, at most once per doc per 100 ms |
| `listing-changed` | Every connection                        | A doc or folder was added or removed under a root     |
| `roots-changed`   | Every connection                        | A root was mounted or unmounted                       |

A client sends `join` and `leave` with `{ path }`, in the form `getDocument` takes, and gets
an acknowledgement of `{ ok: boolean }`. A join is refused (`ok: false`) when the payload is
malformed or when `getDocument` would refuse the same path for the same caller, including the
restricted-mode path rules. Both sides validate what they receive against the zod schemas in
`packages/shared/realtime.ts`.

Signals are best-effort. A client that reconnects rejoins its document and refetches the
document, the listings and the roots, which repairs any signal it missed while disconnected.

The handshake check depends on the permission mode:

| Mode         | Handshake accepted when                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `full`       | `Host` names this machine (loopback, or the address the connection arrived on) and `Origin` matches it |
| `restricted` | `Origin`, when present, matches `Host`. Any `Host` is accepted                                         |

A refused handshake gets `403`. In full mode the `Host` rule is the check that guards
same-machine privileges over HTTP, and it keeps a DNS-rebinding page from listening. A
restricted server is meant to be reached by name (`mybox.local`, or a domain behind a reverse
proxy). Its rooms only cover public documents and its signals carry nothing, so it checks only
the origin, which keeps another site's page from listening.

One connection may hold at most 16 joined paths. A further join is refused until it leaves one.
The browser client retries at socket.io's usual pace while the server is unreachable, and once
a minute after the server refuses its handshake.
