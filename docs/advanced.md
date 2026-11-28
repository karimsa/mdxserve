# mdxserve for power users

The [README](../README.md) gets you serving a folder. This page is what sits underneath: how
the single server is found and shared, what the rules for roots and URLs are, what changes
when you expose it on a network, and the full story on the agent CLI and the cache.

## Page metadata

Leading YAML frontmatter can declare `title`, `description`, `canonical`, and `openGraph`. The server reads these fields as data and places them in the initial HTML head. Metadata extraction does not execute document JavaScript, including on restricted servers. The same metadata is available in the browser.

`title` sets the browser title, `description` emits a description meta tag, and `canonical` emits a canonical link. They do not generate Open Graph tags automatically. Declare sharing values explicitly in an ordered `openGraph` list:

```yaml
---
title: A project guide
description: Setup and usage for the project.
canonical: https://docs.example.com/guide
openGraph:
  - property: og:title
    content: A project guide
  - property: og:description
    content: Setup and usage for the project.
  - property: og:type
    content: article
  - property: og:url
    content: https://docs.example.com/guide
  - property: og:image
    content: https://docs.example.com/overview.png
  - property: og:image:width
    content: 1200
  - property: og:image:height
    content: 630
  - property: og:image:alt
    content: Project architecture diagram
  - property: og:image
    content: https://docs.example.com/details.png
  - property: og:image:alt
    content: Detailed component diagram
---
```

Each list entry has a `property` beginning with `og:` and a string or finite numeric `content`. Entries retain their order, including repeated properties. Put an image's width, height, and alt text immediately after that image. Other frontmatter fields remain available for your own metadata and stay hidden from the visible body.

Canonical links and Open Graph URL values must use absolute HTTP or HTTPS URLs. Use public URLs for shared pages. mdxserve does not infer a production hostname or rewrite local filesystem paths into public URLs.

Malformed metadata produces `frontmatter-metadata` warnings from `mdxserve validate`. Invalid metadata falls back to the filename title and omits the declared head metadata, while the document body can still render. YAML aliases, duplicate keys, oversized metadata, and unsupported tags are rejected for metadata extraction. Edit metadata in the source file; saving a body section preserves the leading YAML block.

The frontmatter block must be at the beginning of the document. A YAML example in a code fence or a later thematic break does not declare page metadata. Frontmatter is the only way to set page metadata: a document cannot import components or evaluate expressions, and head tags such as `<title>` and `<meta>` are not supported elements.

## Comments

On a full-permission server, select text inside one block of a page and a comment button
appears next to the selection. Press it, type, and submit; the text stays highlighted. Threads
are listed in a sidebar on the right on screens 768 px and wider, and in a sheet that rises from
the bottom on narrower ones. Each thread shows a quote of its text and its messages, labelled as
written by a human or by an agent. You can reply, edit a message a human wrote, resolve a thread,
switch the panel to Resolved, and reopen one. A selection that crosses blocks is clipped to the
block where it starts. While a section editor is open, the controls that write are disabled.
`.md` and `.mdx` behave the same.

Threads are stored in the doc's leading frontmatter under `comments`, so they travel with the
file and an agent answers by editing it. Page metadata ignores the key.

```yaml
---
title: Getting started
comments:
  - id: k3J9xQ2a
    anchor:
      heading: Installation
      block: Run the installer, then restart your shell so the new PATH entry is picked up.
      quote: restart your shell
    resolved: false
    messages:
      - id: Zp41mD0c
        author: human
        body: Is a restart still needed on fish?
        createdAt: 2026-11-24T19:02:11.000Z
---
```

| Field                   | Rule                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `id` (thread, message)  | 1 to 64 characters of letters, digits, `_` and `-`; unique in the doc / in the thread |
| `anchor.heading`        | 1 to 300 characters, or `null` before the first heading                               |
| `anchor.block`          | 1 to 500 characters                                                                   |
| `anchor.quote`          | 1 to 500 characters                                                                   |
| `resolved`              | `true` or `false`; `false` when absent                                                |
| `messages`              | 1 to 100 entries                                                                      |
| `author`                | `human` or `agent`                                                                    |
| `body`                  | 1 to 4000 characters                                                                  |
| `createdAt`, `editedAt` | ISO 8601 date-time, optional                                                          |

The anchor strings hold rendered text with whitespace collapsed to single spaces. `heading` is
the nearest heading, `block` is the last 500 characters of the block's text, and `quote` is the
highlighted words. When the doc changes, a thread is placed in this order:

| State           | When                                                 | Shown                                 |
| --------------- | ---------------------------------------------------- | ------------------------------------- |
| Exact text      | The block is found and contains the quote            | The quote is highlighted              |
| Whole block     | The block is found but the quote is not in it        | The whole block is highlighted        |
| Section heading | A matching heading exists but the block is not found | Attached to the heading, no highlight |
| Detached        | No heading has that text                             | Listed last under "Detached"          |

If a quote appears twice in a block, the first occurrence is highlighted. Renaming a heading
detaches the threads under it.

Frontmatter is limited to 64 KiB, shared with page metadata. A comment write that would exceed it
is refused; that holds roughly 50 to 80 threads, resolved ones included, so remove old resolved
threads from the file by hand. A write is also refused when the existing frontmatter is not valid
YAML. The first server write re-serializes the frontmatter: keys, values and YAML comments are
kept, but quoting and indentation can change. Body lines are never touched.

Restricted servers show threads read-only, with no control that adds, edits, replies to or
resolves one. Comments are public wherever the doc is served, and they are committed with the
file.

`mdxserve validate` reports a malformed `comments` entry as a `frontmatter-comments` warning and
a thread whose heading or block cannot be found as a `comment-anchor` warning. The anchor check
reads the Markdown tree, so text a component produces from props is invisible to it. Both are
warnings and never fail validation.

## One server per user

Only one `mdxserve serve` runs per user at a time. On start it takes a pid lockfile at
`~/.mdxserve/server.lock` and writes its record — pid, port, host, and the roots it serves —
to `~/.mdxserve/servers.db`, a SQLite database opened through `better-sqlite3`. Its locks
are OS file locks, so a process that is killed while using the database never leaves it
locked. Every other command finds the server through that record:

| Command                                | Talks to the running server?          |
| -------------------------------------- | ------------------------------------- |
| `mdxserve roots add \| remove \| list` | Yes, over its HTTP API                |
| `mdxserve status`                      | Yes; exits 1 when nothing is running  |
| `mdxserve validate`                    | When one is running; else static only |
| `mdxserve search \| docs`              | Yes; exit 1 when nothing is running   |
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

### Server identity

The first time a server starts it writes a random `serverId` (a UUID) to `config.json` and
keeps it from then on, so a client can tell one server from another however it reaches it:
through `localhost`, a LAN address or a tailnet name. Its name is the computer's hostname
without `.local`, or what you pass with `serve --name <name>` (at most 63 bytes). The id, the
name, the version, the permissions mode and the `tailscale serve` addresses are what
`getServerInfo` answers; it never names a mounted folder. Removing `serverId` makes the server
a new one to every client that knew it. Each `MDXSERVE_HOME` has its own id.

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

The server binds to `127.0.0.1` by default. Permission mode defaults to `full` on
loopback and `restricted` on other interfaces. Startup prints the effective mode.
`localhost` is pinned to `127.0.0.1` without DNS resolution. IPv4 loopback addresses
and `::1` also default to full permissions. Other hostnames default to restricted,
even if they currently resolve to loopback.

For a public site, use [`--permissions restricted`](../README.md#hosting-a-public-reader).
It requires one explicit root, ignores saved roots, and denies all HTTP mutations
regardless of the peer address. Select it explicitly when a reverse proxy connects
to a loopback listener:

```bash
mdxserve serve --permissions restricted -w ./public
```

### Through `tailscale serve`

To read and edit from your other devices, keep the server on loopback and publish it to your
tailnet with `tailscale serve`, which proxies HTTPS on the tailnet to the local port. When
Tailscale is running and nothing publishes the server yet, startup prints the command on
stderr, for example:

```text
Tailscale is running. To open this server from your other devices over HTTPS:
  tailscale serve --bg --https=4040 http://127.0.0.1:4040
It will be at https://my-laptop.tail1234.ts.net:4040 (tailnet only).
Then restart this server: it reads the Tailscale configuration once, at startup.
```

The server reads the Tailscale configuration once, when it starts. After adding or changing a
`tailscale serve` entry, restart the server.

Once an entry proxies `/` to the server's port, startup lists its address as
`- Tailnet:  https://…`. The server looks for the CLI on `PATH`, then in
`/Applications/Tailscale.app/Contents/MacOS/Tailscale` on macOS and
`%ProgramFiles%\Tailscale\tailscale.exe` on Windows. Set `MDXSERVE_TAILSCALE_CLI` to use
another one, `MDXSERVE_DEBUG=1` to see why detection failed, or pass `--no-tailscale` to skip
it. Detection runs once, after the server is listening, and never delays it.

What a tailnet reader gets:

- Live updates. In full mode the live update socket only accepts a `Host` that names this
  machine, as a defence against DNS rebinding. It also accepts the addresses
  `tailscale serve status --json` reports as proxying `/` to this port, and only on
  connections from loopback, where `tailscale serve` connects from. An entry added after
  startup serves pages, but they get no live updates until the server restarts.
- Reading and editing, with full permissions. Every device on the tailnet can edit.
- Not the same-machine privileges: a request with a tailnet `Host` cannot mount or unmount
  roots.

Mount the proxy at `/` with a target that has no path; a sub-path (`--set-path`) or a target
such as `http://127.0.0.1:4040/docs` does not work, and startup says so.
`tailscale funnel` makes the address public on the internet; startup warns when a Funnel
address reaches a server with full permissions. Turn it off with
`tailscale funnel --https=<port> off`, or run with `--permissions restricted`.

### A QR code for the app

`mdxserve qr` prints a QR code of the running server's address, with the address under it.
Scan it in the mdxserve app from Servers, Add server, Scan a QR code. The code holds one URL,
the address followed by the server's id, for example
`https://my-laptop.tail1234.ts.net:4040/#mdxserve=7f0c2c1e-…`. It holds no secret: the id is
what `getServerInfo` tells anyone who can reach the server. The app adds the server only when
that address answers with the same id. Because the code is an ordinary URL, a phone's own
camera opens the web client from it.

The address is the first `tailscale serve` one, so the phone must be on your tailnet. With
`--lan`, or when there is none, it is the address the server listens on for the local network
(`--host`); for a wildcard bind such as `0.0.0.0`, the computer's first network address that
is not a Tailscale or link-local one. A server that listens only on this computer and has no
`tailscale serve` address cannot be opened from another device, so `mdxserve qr` says so and
exits 1. `--json` prints `{ "url", "payload", "via" }` instead of the code, where `payload` is
the code's text and `via` is `tailnet` or `lan`.

### On a trusted network

To allow full permissions on a trusted network, specify both options:

```bash
mdxserve serve --host 0.0.0.0 --permissions full --dangerous-allow-network
```

Full permissions on a non-loopback interface are rejected without the dangerous flag.
The dangerous flag alone does not change the default permission mode. These options
apply to the current invocation and are not stored in the JSON config.

Full network access exposes **all configured roots**, including roots saved during
earlier local sessions and roots added through later config edits. The following
caller restrictions still apply in full mode.

Network clients can read and search the served roots. Two things are held back for callers that are not on the same machine:

| Capability                                                 | Loopback caller | Remote caller                                                          |
| ---------------------------------------------------------- | --------------- | ---------------------------------------------------------------------- |
| `mdxserve roots add \| remove`, `addRoots` / `removeRoots` | Allowed         | `FORBIDDEN`                                                            |
| Any mutation                                               | Allowed         | Rejected with 403 when the request's `Origin` doesn't match its `Host` |

The `Origin` check means a page on another site cannot drive the write endpoints even when
the server is bound to `0.0.0.0`. The section editor and the Trash action are mutations too,
so they follow the same rule.

A remote caller of a full server can read any file in a mounted root through `getAsset`
(`/__mdxserve/getAsset?path=<absolute path>`), the endpoint images load from, except
documents, anything under `.git`, `.env` files and `.pem`/`.crt` keys. A restricted server
also refuses hidden and `node_modules` paths. Use full permissions on a network interface
only on a network you trust.

## The agent CLI

Every verb below is a thin client of the running server's HTTP API (except where noted), and
each takes `--json` for scripting. Paths are absolute, in the same form as the site's URLs.

### Verbs

| Verb                                   | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mdxserve validate <paths...>`         | Parses each `.md`/`.mdx` file with the same parser that builds the document tree a reader gets, and reports syntax errors (per `#`/`##` section), every break of the [document rules](#document-rules), unknown props, prop values of the wrong type, the [`id` rules](#ids-and-anchors), mermaid chart fences (`pie`/`xychart-beta`/`quadrantChart`/`sankey-beta` — use `<Chart>` instead), and comment threads in the frontmatter (malformed entries and anchors that no longer match, as warnings). Exits 1 on any error |
| `mdxserve document <file>`             | Parses one file into the JSON document tree a client receives from `getDocument`, with no server. `--json` prints the tree; without it, the table of contents with each entry's anchor                                                                                                                                                                                                                                                                                                                                      |
| `mdxserve search <query>`              | The `⌘K` search: one `<path> — <title>` line per match, with an excerpt                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `mdxserve docs [dir] [--depth n]`      | The doc tree of every served root, or of one directory                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `mdxserve roots list \| add \| remove` | Every served root; serves or stops serving absolute directories on the running server                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `mdxserve qr [--lan]`                  | Prints a [QR code of the server's address](#a-qr-code-for-the-app) for the mdxserve app to scan                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `mdxserve components search [q]`       | Lists the builtin components, filtered by name, description, or prop name                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `mdxserve components show <name>`      | Props table (types, defaults) and when to use a builtin                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### What happens with no server, or no roots

| State                    | `search`, `docs`                                                                                            | `validate`                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| No server running        | "No mdxserve server is running; start one with `mdxserve serve -w <dir>`", exit 1                           | Validates the file directly; the checks are the same |
| Server running, no roots | "The mdxserve server is running but serves no folders yet; add one with `mdxserve roots add <dir>`", exit 1 | Absolute path works fully                            |

### What `mdxserve validate` checks

`validate` reads the file with the parser that builds the document tree a reader gets and
checks it statically: syntax (per `#`/`##` section), the document rules, component and prop
names, prop values against each builtin's schema, ids, mermaid chart fences and comments. It
does not run or render the document; a document is data, so a builtin that throws for props it
accepted is a bug in mdxserve, shown on the page as an error box in place of that builtin.

A `pie`, `xychart-beta`, `quadrantChart`, or `sankey-beta` mermaid fence is always an `error`
diagnostic with code `mermaid-chart` — mdxserve doesn't render these, so the doc should use the
builtin `<Chart>` component (bar, line, area, histogram) or a table instead. Every other mermaid
diagram (flow, sequence, class, state, ER, gantt, timeline, gitGraph, mindmap, journey, …) is
unaffected.

### Document rules

A document can use only the builtin components, a fixed set of lowercase elements, and literal
values. `.md` and `.mdx` follow the same rules. Each break is an `error` diagnostic whose message
names the fix, and the page still renders without the offending part:

| Code                     | Raised for                                                                                           | What renders                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `esm-not-supported`      | An `import` or `export` statement                                                                    | Nothing; the statement is ignored                               |
| `non-literal-expression` | A brace expression that is not an array, object, string, number, boolean or null, or a `{...spread}` | Nothing; a prop is dropped                                      |
| `unknown-component`      | A capitalized tag that is not a builtin                                                              | The tag's children                                              |
| `removed-component`      | `Button`, `Dropdown` or `Option`, which are no longer builtins                                       | The tag's children                                              |
| `unsupported-element`    | A lowercase tag outside the supported list; `script` and `style` lose their children too             | The tag's children                                              |
| `unsupported-attribute`  | `className`, `style`, any `on*` attribute, or a lowercase element's attribute off its allowlist      | The element, without the attribute                              |
| `invalid-href`           | A link (Markdown, `<a href>` or `Card` `href`) whose scheme is not http, https or mailto             | The link text with an empty target; a `Card` without its `href` |
| `invalid-prop`           | A builtin prop whose value does not match the type the builtin declares, or a missing required prop  | The component, without the prop                                 |
| `mdx-syntax`             | A `#`/`##` section that does not parse (a stray `{` or `<`, an unclosed tag)                         | The section's source, as text                                   |

Supported lowercase elements: `kbd`, `abbr`, `sub`, `sup`, `mark`, `b`, `i`, `u`, `s`, `em`,
`strong`, `small`, `br`, `span`, `details`, `summary`, `table`, `a` and `img`, plus `thead`,
`tbody`, `tr`, `th` and `td` inside a `table`. Their allowed attributes are `title` on `abbr`,
`open` and `id` on `details`, `href` and `title` on `a`, `src`, `alt`, `title`, `width` and
`height` on `img`, and `colspan`, `rowspan` and `align` on `th` and `td`.

A literal in a prop reaches the component as is. In prose, a string or number shows as its
text, an array or object as its `JSON.stringify` text, and `true`, `false` and `null` show
nothing. An empty or comment-only expression such as `{/* note */}` is allowed and shows
nothing.

### IDs and anchors

Every section, tab and stateful component has an ID in the JSON document tree that stays the
same across edits elsewhere in the document. A stateful component's authored `id` is what the
reader's state for it (the selected tab, a table's sort and filters, an open `details`) is
kept under.

| Node                                                                      | ID                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A section whose heading text is unique                                    | The heading's slug: `## Install it` is `install-it`                                       |
| A section whose heading text repeats                                      | Its path of slugs from the top heading, joined with `>`: `guide>install>examples`         |
| `DataTable`, `Tabs`, `Diff`, `FileTree`, `Chart`, `Screenshot`, `details` | The authored `id`: a letter, then letters, digits, `-` and `_`                            |
| A tab                                                                     | The `Tabs` id, `>`, and the tab's `value` (the label, lowercased, by default): `os>macos` |
| Content before the first heading                                          | `~preamble`                                                                               |

A heading inside a tab is pathed from its tab (`os>macos>install`), so the same heading in
two tabs is not a repeat. These ids are what the JSON document tree (`getDocument`,
`mdxserve document`) carries, and they are the page's URL anchors: a heading, and a tab
(`#os>macos` selects that tab and scrolls to it). A fragment that matches no id goes to the
first heading whose id ends with `>` and the fragment, so `#examples` still
reaches an "Examples" heading after a second one turned both ids into paths. Repeated headings
no longer get the `-1`, `-2` anchors of earlier releases, but those still resolve: when no id
and no `>` suffix matches, `#examples-1` goes to the second heading whose own slug is
`examples`, in document order, and `#examples-2` to the third. A heading whose slug really
ends in a number, such as `## Step 1` (`step-1`), matches exactly first.

Each break of these rules is an `error` that names the fix, and the document still renders:

| Code                        | Raised for                                                                                                  | What renders                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `missing-id`                | A stateful component or `details` with no `id`                                                              | The component, with a generated ID                     |
| `invalid-id`                | An `id` that does not match the pattern                                                                     | The component, with a generated ID                     |
| `duplicate-id`              | An `id` used earlier in the document                                                                        | The later one, with a generated ID                     |
| `id-conflicts-with-heading` | An `id` equal to the slug of any heading, repeated or not                                                   | The heading keeps the anchor                           |
| `duplicate-heading`         | Two headings with the same text under the same parent                                                       | The later one, with a suffixed ID                      |
| `duplicate-tab-value`       | Two tabs with the same `value` in one `Tabs`                                                                | The later tab, with a generated value                  |
| `invalid-tab-default`       | A `defaultValue` that matches no tab                                                                        | The first tab selected                                 |
| `invalid-tabs-structure`    | Content directly inside `Tabs` that is not a `Tab`, a `Tab` outside `Tabs`, or `Tabs` inside a line of text | The content: before the tabs, or in place without tabs |

The result also carries `hints`: an array of advisory strings that never affect `ok`. Today
there is one — a Markdown image whose alt text or path mentions "screen" is probably a
screenshot, and the hint points the agent at the builtin `<Screenshot>` component, which frames
it as a macOS window with an expand view. The text output prints each as a `hint:` line after
the diagnostics.

## The agent skill

`skills/mdxserve/SKILL.md` teaches an agent how to write Markdown that renders well here while
staying portable: prefer plain GFM, tag every code fence, keep diagrams small, use a builtin
only when it clarifies, and validate the file afterwards. It points the agent at
`mdxserve components` and `mdxserve validate`. `skills/mdxserve-run/SKILL.md`
(`mdxserve:run`) tells an agent how to run the server: check for one, start it (under `oxmgr`
when it is installed), manage roots, stop it, and publish it with `tailscale serve`.
`mdxserve setup` installs both with
`npx skills add` for Claude Code, Codex, and `~/.agents/skills`; re-run `mdxserve setup` after
upgrading (or, in a checkout, after editing anything under `packages/server/skills/`), since the skills CLI
copies rather than symlinks.

## The cache

The browser client ships prebuilt, so the server keeps no cache of its own. Earlier releases
pre-bundled browser dependencies under `~/.cache/mdxserve/vite/` (or
`$XDG_CACHE_HOME/mdxserve/vite/`); nothing reads that folder any more.

```bash
mdxserve cache clean          # remove what older releases left in the cache folder
```

## Environment variables

| Variable                 | Default              | Controls                                                   |
| ------------------------ | -------------------- | ---------------------------------------------------------- |
| `MDXSERVE_HOME`          | `~/.mdxserve`        | Where the server lock and `servers.db` live                |
| `MDXSERVE_CACHE_HOME`    | `~/.cache/mdxserve`  | The cache folder `mdxserve cache clean` removes            |
| `XDG_CACHE_HOME`         | `~/.cache`           | Honoured for the cache when `MDXSERVE_CACHE_HOME` is unset |
| `MDXSERVE_TAILSCALE_CLI` | `PATH`, then the app | The Tailscale CLI the server asks about `tailscale serve`  |
| `MDXSERVE_DEBUG`         | unset                | When set, startup says why Tailscale detection failed      |
