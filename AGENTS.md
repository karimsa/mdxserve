## Working with mdxserve

- Every worktree will automatically run `yarn` to update dependencies and make sure the build is ready to go
- Run `yarn dev` to start a dev server: it runs the backend from source on a free port, under its own
  `MDXSERVE_HOME` in `node_modules/.cache/mdxserve-dev` (so it never meets the one-server lock of a real
  server), and a Vite dev server for `apps/web` that proxies `/__mdxserve` (tRPC, `getAsset`, the socket)
  to it. Vite prints its URL; it moves off port 5173 when that is taken. Run it through `oxmgr`, for
  example `oxmgr start --name mdxserve-dev "yarn dev"`; `yarn dev -w <dir>` serves another folder
- Test the visual interactivity and rendering in a browser by navigating over to the Vite dev server's port
- Production never runs Vite: `yarn build` compiles `apps/web/src/` into `packages/server/dist/client/`
  (`apps/web/vite.config.ts`), and `node packages/server/dist/cli.js serve` serves that bundle
- Run the `yarn` scripts (`build`, `test`, `lint`, `typecheck`, `deadcode`, …) from the repository root

## Workspaces

| Workspace          | Package                                     | Holds                                                               |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------- |
| `packages/server/` | `@karimsa/mdxserve`, the only one published | the server and CLI (`src/`), its tests, build scripts and `skills/` |
| `packages/shared/` | `@mdxserve/shared` (private)                | code both the server and the web client run                         |
| `packages/ui/`     | `@mdxserve/ui` (private)                    | components the web client and the app both render (`src/`)          |
| `apps/web/`        | `@mdxserve/web` (private)                   | the browser client (`src/`) and its tests                           |
| `apps/site/`       | `@mdxserve/site` (private)                  | the project website, deployed to Vercel                             |
| `apps/mobile/`     | `@mdxserve/mobile` (private)                | the Expo iOS app (`app/` routes, `src/`) and its tests              |

The root holds the shared tooling, `scripts/dev.ts` and `scripts/changelog.ts`.
A workspace depends on another with a `workspace:*` range. The server's esbuild bundle inlines
`@mdxserve/*` packages, so a workspace package is never left as an import in the published
output. The web client's build writes into the server package's `dist/`.

## Working on the app

`apps/mobile/` is an Expo app (SDK 58, Expo Router). `yarn mobile <script>` runs one of its
scripts from the repository root, and `yarn mobile expo <args>` runs any Expo CLI command:

- The app runs in two hosts. `yarn mobile start --go` starts Metro for Expo Go: scan its QR
  code on an iPhone on the same network. `yarn mobile start` (no flag) starts it for the
  development build, because `expo-dev-client` is installed
- The development build is the app with its own native code, installed on a registered device
  from the EAS `development` profile (`developmentClient: true`, internal distribution). Some
  behaviour only exists there: Expo Go 58.0.5 has no `ExpoStatusBar` native module, so
  `verticalBarBehaviorIOS` (iPhone Duo's top bar when unfolded) does nothing in Expo Go
- Keep the app runnable in Expo Go until phase 4: use only modules Expo Go ships (Expo SDK 58's
  `bundledNativeModules.json`) and no config plugin that needs a native build. Once phase 4
  adds native modules of its own (Bonjour, the selection menu), Expo Go stops working
- `yarn mobile ios` (`expo run:ios`) builds the app and opens it in the iOS simulator, which
  needs Xcode and an iOS simulator runtime
- Test anything that touches the local network on a device: the iOS simulator does not enforce
  local network privacy
- `yarn mobile test` runs the jest-expo component tests in `apps/mobile/tests/`; the root
  `yarn test` runs them too. `yarn mobile typecheck` and `yarn mobile doctor` (Expo Doctor)
  check the rest. The `Mobile` CI job runs those three and bundles the app for iOS
  (`yarn mobile expo export --platform ios`)
- Every workspace uses the React version the Expo SDK pins, and `yarn constraints` fails when
  they disagree. Upgrade React only together with the Expo SDK
- `yarn mobile doctor` compares the app's packages with the newest patch of its Expo SDK, so it
  reports new Expo releases. CI runs it with `EXPO_OFFLINE=1`, which compares them with the
  pins of the installed `expo` package instead: a new Expo release alone never fails CI
- The app uses TypeScript 7 like every other workspace, not the 6.x Expo expects, so
  `typescript` is in `expo.install.exclude` in its `package.json`
- `app.config.ts` holds the app's identity: bundle identifier, Apple team, Expo account and
  EAS project. Never run `eas build` or `eas submit` unasked

## Architecture

The backend (`packages/server`) is hexagonal: domain modules in the middle, adapters at the
edges. An adapter only ever reaches the domain through a service, and a service never knows
which adapter is calling it. Paths in this section are relative to `packages/server/`.

### Domain modules

Each top-level folder in `src/` with a `service.ts` is a domain module: `roots/`, `docs/`,
`listing/`, `search/`, `validation/`, `trash/`, `components/`, `setup/`, `diagrams/`,
`document/`, `assets/`, `comments/`, `preferences/`, `server-info/`, and `tailscale/`. `setup/` is
CLI-only (no `controller.ts`), and its `runner.ts` delegates to `src/infra/process-runner.ts`, the only process-spawning
adapter. Non-interactive diagram agents use that same bounded, cancellable adapter.
`tailscale/` has no controller either: `TailscaleService.detect` asks the Tailscale CLI (through
`tailscale/runner.ts`, the same adapter) which `tailscale serve` addresses reach this server.
`startServer` holds the result in `TailnetHosts`, which the live update handshake trusts.
`document/` has no controller either: `DocumentService.parse` turns source text into the JSON
document tree, its diagnostics and its line ranges, and its procedure (`getDocument`) lives in
`docs/controller.ts`, behind `DocsService.readDocument`.
`assets/` has no controller: `AssetsService.locate` decides which non-document file in a root
may be served, and its endpoint, `getAsset`, is a plain HTTP GET in `src/http/asset.ts`
because its result is the file's bytes, not JSON. Its query is still a zod schema.

- `service.ts` — a small class whose constructor takes the concrete values it needs (a
  `RootInfo[]`, a `Registry`, another service instance). Business rules
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
  spreads into the aggregate router. A schema `src/cli/` needs is exported so the verb reuses
  it instead of keeping a second copy; the rest stay private to the file.
- Pure helpers stay plain exported functions in their own files (`roots/paths.ts`,
  `docs/edit.ts`, `listing/tree.ts`, …). Write a class only when there is a dependency to hold
  or state to own — never wrap a pure function in one for symmetry.

### No container

There is no service registry, factory, or dependency-injection bag. An adapter `new`s the
service it needs, inline, with the values it already has; a stateless service may be
constructed per request, and two adapters constructing the same service is fine. Only
genuinely per-process state is created once — in `startServer` (`src/http/start.ts`) or a
CLI command — and carried through the request context: `DocCache`, `SearchService`,
`DocsService` (it owns the per-file save lock), `RootsService` (it owns the mutable set of mounted roots and its change hook), `ServerLock`,
`DiagramsService` (it owns conversion scheduling, sessions and temporary uploads),
`TailnetHosts` (it owns the trusted tailnet `Host` set and its rate-limited refresh),
`ServerInfoService` (the server's id, name, version and permissions, and its `TailnetHosts`;
the id is written once to `MDXSERVE_HOME/config.json` by `server-info/server-id.ts`),
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

### Dependency direction

`yarn lint` enforces these:

- The web client's source (`apps/web/src/`) may only `import type` from `@karimsa/mdxserve`
  (nothing in the server package is served to the browser); for example `AppRouter` from
  `@karimsa/mdxserve/src/api/router` and the document tree types from
  `@karimsa/mdxserve/src/document/schema` (re-exported for the renderer by
  `apps/web/src/document/tree-types.ts`). Its tests may run server code.
- `@mdxserve/shared` holds code both sides run: each builtin's zod prop schema
  (`builtins/<name>.ts`), the live update socket's event names and payload schemas
  (`realtime.ts`) and mermaid header detection (`mermaid-chart.ts`). The server and the web
  client import values from it through the subpaths in its `exports`. It imports no React value
  (type-only imports are fine) and nothing from the server or the web client.
- `@mdxserve/ui` holds the components both clients render, written with React Native
  primitives and Tailwind class names. Uniwind turns the class names into styles: through
  react-native-web in the web client (`apps/web/vite.config.ts`) and through Metro in the app
  (`apps/mobile/metro.config.js`). It imports neither client nor the server, no `react-dom`
  and no Expo module. A file that needs the DOM is a `Name.web.tsx` beside `Name.tsx`, which
  the web build picks instead; browser globals and web-only modules appear only there. Its `src/theme.css` holds the design tokens both clients
  read; a token that changes with the theme sits in a `@variant light` and a `@variant dark`
  block, which follow `data-theme` on the web and Uniwind's theme (the system's) in the app
- The server, its tests included, never imports the web client or `@mdxserve/ui`.

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
- No dead code. `yarn deadcode` (knip, configured per workspace in `knip.ts`) fails on an unused file,
  export, type, dependency or devDependency, and on a package imported but not listed. It
  runs twice: once over everything, and once with `--production`, which leaves the tests out,
  so an export only a test uses also fails. Delete what it reports. When a test genuinely
  needs a helper the product keeps private, prefer testing through the public function; failing
  that, tag the export `/** @internal Exported for its tests. */`. Do not add ignore entries
  to `knip.ts` without a one-line reason. It cannot see CSS selectors that match nothing, or
  comments about code that is gone: check those by hand

## Writing tests

- Each workspace keeps its tests in its own `tests/` and its own `vitest.config.ts`; `yarn test` at the root runs them all
- Server tests mirror the modules: `packages/server/tests/<module>/service.test.ts`, `service.property.test.ts`, `controller.test.ts`, `controller.property.test.ts`; adapters get `tests/api/`, `tests/cli/`, `tests/http/`, `tests/servers/`, `tests/realtime/`
- App component tests live in `apps/mobile/tests/` and run under jest-expo, not vitest
- Web client tests live in `apps/web/tests/`, shared code tests in `packages/shared/tests/`, and tests of the root scripts and GitHub Actions gates in `tests/automation/`
- Every service should have a set of property tests that validate the guarantees provided by the interface
- Every service should have tests that validate its core functionality
- The client renders documents from the JSON tree (`apps/web/src/document/`): one memoized renderer per node type, keyed by node id or index. Heading and tab anchors are tree ids; navigate to a node with `revealNode(id)`, which selects the tabs on the way

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

1. Create a release branch from the latest `origin/main`. In `packages/server`, run
   `npm version minor --no-git-tag-version --no-workspaces-update` (or the requested version
   bump; without `--no-workspaces-update` npm fails on the `workspace:` ranges). Then fetch
   tags and, from the repository root, run `yarn changelog <version>` to generate the new
   root `CHANGELOG.md` entry from merged commit subjects and PR references. Review
   the notes, commit the version and changelog together with the required
   `Co-authored-by` trailer, and open a PR titled only with the version number.
   Regenerate the changelog if more changes merge before the release PR. `main`
   requires a PR and passing status checks.
2. Wait for the release PR to merge, then fetch and check out the merged commit on `main`.
   Confirm `packages/server/package.json` contains the intended release version.
3. Create an annotated tag on that merged commit matching the package version
   (for example, `git tag -a v0.5.0 -m 'Release 0.5.0'`), then push that tag
   (`git push origin v0.5.0`). Create and push the release tag only after the PR merges.
4. Verify the tag-triggered Release workflow succeeds. It publishes the package to
   npm and then promotes the site deployment.

### Release candidates

A release candidate is an npm-only release: it is published under the `next` dist-tag and
never changes the live site or `CHANGELOG.md`.

1. Create a release branch from the latest `origin/main` and set the version explicitly in
   `packages/server`, for example
   `npm version 0.6.0-rc.1 --no-git-tag-version --no-workspaces-update`. For a later candidate
   of the same release, `npm version prerelease --no-git-tag-version --no-workspaces-update`
   gives `0.6.0-rc.2`. Do not run `yarn changelog`: it accepts stable versions only.
2. Commit the version with the required `Co-authored-by` trailer and open a PR titled only
   with the version number (`0.6.0-rc.1`). The changelog generator omits these commits.
3. After the PR merges, tag the merged commit to match the package version
   (`git tag -a v0.6.0-rc.1 -m 'Release 0.6.0-rc.1'`) and push the tag.
4. Verify the Release workflow publishes to npm and skips the site promotion job. Install a
   candidate with `npm install @karimsa/mdxserve@next`.
5. For the stable release, follow the steps above with
   `npm version 0.6.0 --no-git-tag-version --no-workspaces-update`.
   `yarn changelog 0.6.0` lists every change since the previous stable release, including
   those that shipped in candidates.
