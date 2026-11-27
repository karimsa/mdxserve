## Working with mdxserve

- Every worktree will automatically run `yarn` to update dependencies and make sure the build is ready to go
- Run `yarn dev` to start a dev server: it runs the backend from source on a free port, under its own
  `MDXSERVE_HOME` in `node_modules/.cache/mdxserve-dev` (so it never meets the one-server lock of a real
  server), and a Vite dev server for `client/` that proxies `/__mdxserve` (tRPC, `getAsset`, the socket)
  to it. Vite prints its URL; it moves off port 5173 when that is taken. Run it through `oxmgr`, for
  example `oxmgr start --name mdxserve-dev "yarn dev"`; `yarn dev -w <dir>` serves another folder
- Test the visual interactivity and rendering in a browser by navigating over to the Vite dev server's port
- Production never runs Vite: `yarn build` compiles `client/` into `dist/client/` (`vite.config.ts`), and
  `node dist/cli.js serve` serves that bundle

## Architecture

The backend is hexagonal: domain modules in the middle, adapters at the edges. An adapter
only ever reaches the domain through a service, and a service never knows which adapter is
calling it.

### Domain modules

Each top-level folder in `src/` with a `service.ts` is a domain module: `roots/`, `docs/`,
`listing/`, `search/`, `validation/`, `trash/`, `components/`, `setup/`, `diagrams/`,
`document/`, `assets/`, and `preferences/`. `setup/` is
CLI-only (no `controller.ts`), and its `runner.ts` delegates to `src/infra/process-runner.ts`, the only process-spawning
adapter. Non-interactive diagram agents use that same bounded, cancellable adapter.
`document/` has no controller either: `DocumentService.parse` turns source text into the JSON
document tree, its diagnostics and its line ranges, and its procedure (`getDocument`) lives in
`docs/controller.ts`, behind `DocsService.readDocument`.
`assets/` has no controller: `AssetsService.locate` decides which non-document file in a root
may be served, and its endpoint, `getAsset`, is a plain HTTP GET in `src/http/asset.ts`
because its result is the file's bytes, not JSON. Its query is still a zod schema.

- `service.ts` — a small class whose constructor takes the concrete values it needs (a
  `RootInfo[]`, a `Registry`, a render function, another service instance). Business rules
  live here and nowhere else. Any mutable state (a cache, an index, a lock) is an instance
  field, never module scope, so a test can build a fresh one. Methods return result unions
  (`{ kind: "ok", … } | { kind: "not-found", message } | …`), never transport errors, and the
  file imports nothing from `@trpc/*`, `@modelcontextprotocol/*`, `node:http`, or any
  `controller.ts`.
- `controller.ts` — the tRPC procedures for that module plus the zod schemas for their inputs
  and outputs. Every procedure is built with `procedure("<description>")` from
  `src/api/trpc.ts`, so it must say what it is for. A procedure constructs the service it
  needs, calls one method, and maps the result `kind` to a `TRPCError`; this is the only file
  allowed to throw one. It exports a `<module>Controller` object that `src/api/router.ts`
  spreads into the aggregate router, and exports its schemas so `src/cli/` can reuse them
  instead of keeping a second copy.
- Pure helpers stay plain exported functions in their own files (`roots/paths.ts`,
  `docs/edit.ts`, `listing/tree.ts`, …). Write a class only when there is a dependency to hold
  or state to own — never wrap a pure function in one for symmetry.

### No container

There is no service registry, factory, or dependency-injection bag. An adapter `new`s the
service it needs, inline, with the values it already has; a stateless service may be
constructed per request, and two adapters constructing the same service is fine. Only
genuinely per-process state is created once — in `startServer` (`src/http/start.ts`) or the
a CLI command — and carried through the request context: `DocCache`, `SearchService`,
`DocsService` (it owns the per-file save lock), `RootsService` (it owns the mutable set of mounted roots and its change hook), `ServerLock`,
`DiagramsService` (it owns conversion scheduling, sessions and temporary uploads),
and `ServerRegistry`. Anything that is per-request rather than per-process — whether the caller
is on loopback, and so whether a root mutation may run (`allowMutation`) — is a method
argument, not a constructor argument.

### Adapters

Adapters contain no business logic:

| Folder          | Role                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/api/`      | tRPC init, `ApiContext`, the `procedure()` factory, and the aggregate router (`router({ ...listingController, … })`)                                                                       |
| `src/cli/`      | the commander verbs, one file per verb; they call the same services the tRPC procedures do, so a verb and a procedure cannot drift                                                         |
| `src/http/`     | the node `http` request handler, `startServer` (which creates the chokidar file watcher), the shell filled into the built `index.html`, the prebuilt client's static files, and `getAsset` |
| `src/realtime/` | the socket.io live update adapter (`attachRealtime`): handshake check, `join`/`leave` rooms resolved through `DocsService`, and the three no-payload signals                               |
| `src/servers/`  | the pid lockfile that keeps one server per user, the sqlite record of that server (pid, port, roots), and the tRPC client the CLI and stdio bridge use to reach it                         |
| `src/infra/`    | package root and cache-dir helpers                                                                                                                                                         |
| `src/index.ts`  | the commander CLI                                                                                                                                                                          |

`client/` may only `import type` from `src/` (nothing under `src/` is served to the browser);
for example `AppRouter` from `src/api/router` and the document tree types from
`src/document/schema` (re-exported for the renderer by `client/document/tree-types.ts`).

`shared/` holds code both sides run: each builtin's zod prop schema
(`shared/builtins/<name>.ts`) and the live update socket's event names and payload schemas
(`shared/realtime.ts`). `client/` and `src/` may import values from it. It imports no
React value (type-only imports are fine) and nothing from `client/` or `src/`; the client
build bundles what `client/` imports from it.

## General philosophy

- Settings autosave when changed and take effect immediately. Do not add Save or Apply
  buttons to settings. For asynchronous persistence, show saving status and failures,
  preserve the last saved value on failure, and prevent overlapping writes from losing changes.

- `.md` and `.mdx` must always have identical syntax and behavior. Never choose parsing,
  rendering, validation, or editing behavior based on which extension a document has.
  Any syntax rule or escape hatch must work the same way in both.
- Every service should be cognizant of its service boundaries, revalidating assumptions across boundaries
- All HTTP API methods made available should be strongly typed on both input parameters and result, using zod, ensuring we have both compile-time and runtime type safety
- All HTTP API methods should be GET or POST methods, written as RPC methods (i.e. `getEntityById` vs. `/entity/:id`)
- Never use single-letter variable names, even for small things like `.map(e => e)` or try/catch
  statements. `yarn lint` enforces this (`eslint/id-length`); the only exceptions are `_` for a
  binding you deliberately ignore, and `x`/`y` for a coordinate pair. Property names are not
  checked — `{ opacity: 0, y: 4 }` is a framer-motion key, not a name we chose

## Writing tests

- Tests mirror the modules: `tests/<module>/service.test.ts`, `service.property.test.ts`, `controller.test.ts`, `controller.property.test.ts`; adapters get `tests/api/`, `tests/cli/`, `tests/http/`, `tests/servers/`, `tests/realtime/`
- Every service should have a set of property tests that validate the guarantees provided by the interface
- Every service should have tests that validate its core functionality
- The client renders documents from the JSON tree (`client/document/`): one memoized renderer per node type, keyed by node id or index. Heading and tab anchors are tree ids; navigate to a node with `revealNode(id)`, which selects the tabs on the way

## Creating PRs

- Take screenshots of working functionality and upload them directly to GitHub in the PR description. Do not commit screenshots to the repository.

### PR titles and changelog entries

- Squash-merge PRs using the PR title as the commit subject and preserve GitHub's
  appended PR reference (`(#123)`). `yarn changelog <version>` uses these subjects as release
  notes and turns the references into PR links.
- Use `feat: <change>` for new features and improvements, and `fix: <change>` for
  bug fixes. An optional scope is allowed, for example,
  `feat(editor): Add slash commands for document blocks` or
  `fix(network): Prevent hosted sites from connecting to localhost`.
- Describe the resulting behavior in a concise, standalone title that makes sense
  to someone reading the changelog. Keep implementation details in the PR body.
- Use `docs:`, `chore:`, `build:`, `ci:`, `refactor:`, `style:`, or `test:` for
  maintenance without a user-visible feature or fix. These are omitted from the
  changelog. `perf:` appears under What's new and `revert:` under Bug fixes.
- Mark breaking changes with `!` before the colon and explain the migration in the
  PR body. Choose the release version explicitly, including any breaking changes.
- Title release PRs with only the version number, for example `0.5.0`. The
  changelog generator omits these version commits.

## Releasing

1. Create a release branch from the latest `origin/main`. Run
   `npm version minor --no-git-tag-version` (or the requested version bump),
   then fetch tags and run `yarn changelog <version>` to generate the new
   `CHANGELOG.md` entry from merged commit subjects and PR references. Review
   the notes, commit the version and changelog together with the required
   `Co-authored-by` trailer, and open a PR titled only with the version number.
   Regenerate the changelog if more changes merge before the release PR. `main`
   requires a PR and passing status checks.
2. Wait for the release PR to merge, then fetch and check out the merged commit on `main`.
   Confirm `package.json` contains the intended release version.
3. Create an annotated tag on that merged commit matching the package version
   (for example, `git tag -a v0.5.0 -m 'Release 0.5.0'`), then push that tag
   (`git push origin v0.5.0`). Create and push the release tag only after the PR merges.
4. Verify the tag-triggered Release workflow succeeds. It publishes the package to
   npm and then promotes the site deployment.

### Release candidates

A release candidate is an npm-only release: it is published under the `next` dist-tag and
never changes the live site or `CHANGELOG.md`.

1. Create a release branch from the latest `origin/main` and set the version explicitly, for
   example `npm version 0.6.0-rc.1 --no-git-tag-version`. For a later candidate of the same
   release, `npm version prerelease --no-git-tag-version` gives `0.6.0-rc.2`. Do not run
   `yarn changelog`: it accepts stable versions only.
2. Commit the version with the required `Co-authored-by` trailer and open a PR titled only
   with the version number (`0.6.0-rc.1`). The changelog generator omits these commits.
3. After the PR merges, tag the merged commit to match the package version
   (`git tag -a v0.6.0-rc.1 -m 'Release 0.6.0-rc.1'`) and push the tag.
4. Verify the Release workflow publishes to npm and skips the site promotion job. Install a
   candidate with `npm install @karimsa/mdxserve@next`.
5. For the stable release, follow the steps above with `npm version 0.6.0 --no-git-tag-version`.
   `yarn changelog 0.6.0` lists every change since the previous stable release, including
   those that shipped in candidates.
