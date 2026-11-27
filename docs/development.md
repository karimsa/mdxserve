# Developing mdxserve

How to build, test, and change mdxserve itself. The rules the code follows — the hexagonal
layout, what a service may and may not import, how tests are organised — live in
[`AGENTS.md`](../AGENTS.md), which is written for coding agents but is the architecture
reference for people too. This page is the practical layer on top of it.

## Setup

```bash
git clone git@github.com:karimsa/mdxserve.git
cd mdxserve
yarn
yarn build
```

`yarn build` writes `dist/`, which is what the published package ships. To make your checkout
the `mdxserve` on your `PATH`, run `npm link` once (it points npm's global `mdxserve` at this
checkout's `dist/cli.js`), then `yarn build` after each change. `mdxserve setup` installs the
skill from `skills/` into Claude Code and Codex; re-run it after editing anything under
`skills/`, since the skills CLI copies rather than symlinks.

The project has no native modules and is installed with `enableScripts: false`, so a
dependency that needs a postinstall build will not work. Pick a WASM or pure-JS alternative.

For a git worktree, `./worktree-setup.sh` runs `yarn` so the tree is ready to build.

## Day to day

| Command          | What it does                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `yarn dev`       | Builds, then serves `example/` from source with `tsx` behind a Vite dev server for `client/` with HMR (see below)  |
| `yarn build`     | Generates `dist/registry.json`, bundles the CLI and diagram worker, and builds the client into `dist/client/`      |
| `yarn registry`  | Only the registry step                                                                                             |
| `yarn typecheck` | `tsc --noEmit`                                                                                                     |
| `yarn lint`      | `oxlint` — includes the no-single-letter-names rule                                                                |
| `yarn format`    | `prettier --write .` (`format:check` is what CI runs)                                                              |
| `yarn test`      | `vitest run`                                                                                                       |
| `yarn smoke`     | Packs the tarball, installs it without dev dependencies (no `vite`), runs the CLI and serves `example/` from there |

CI (`.github/workflows/verify-pr.yml`) runs, in order: `yarn constraints`, `format:check`,
`lint`, `typecheck`, `test`, `build`, `smoke`. Run the same set before opening a PR.

### The dev server

The published server never runs Vite: it serves the client prebuilt in `dist/client/`, with a
one-year cache on the hashed files under `/__mdxserve/assets/`. `yarn dev` (`scripts/dev.ts`)
starts two things. The backend runs from source on a free port, with `MDXSERVE_HOME` set to
`node_modules/.cache/mdxserve-dev` unless you set it, so it never meets the
one-server-per-user lock of an `mdxserve` you already run. In front of it, a Vite dev server
for `client/` (`vite.config.ts`) serves the client from source with HMR and proxies
`/__mdxserve` (tRPC, `getAsset` and the live update socket at `/__mdxserve/socket.io`) to
the backend. For a page, it asks the backend for the shell and moves its filled blocks into
the source `client/index.html` (`scripts/dev-shell.ts`). Open the URL Vite prints.

Run it under a process manager so it outlives your terminal, and pass `-w` to serve another
folder:

```bash
oxmgr start --name mdxserve-dev "yarn dev"
oxmgr start --name mdxserve-dev-notes "yarn dev -w ~/notes"
```

Set `MDXSERVE_DEV_BACKEND_PORT` to pin the backend's port.

The `mdxserve` on your `PATH` is a built `dist/cli.js` (the `@karimsa/mdxserve` npm install, or your checkout after
`npm link`), so a change under `src/` or `client/` is not visible to it until you `yarn build`.
`yarn dev` picks up a change under `client/` immediately; restart it after a change under `src/`.

## Where things live

| Path                   | Contents                                                                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                 | The server: domain modules (`roots/`, `docs/`, `listing/`, `search/`, `validation/`, `trash/`, `components/`, `setup/`, `diagrams/`, `document/`, `preferences/`, `assets/`, `comments/`) and adapters (`api/`, `cli/`, `http/`, `realtime/`, `rendering/`, `servers/`, `infra/`); `index.ts` is the CLI |
| `client/`              | The browser app, built by `vite.config.ts` from `client/index.html`: the shell, the document renderer (`document/`, which draws the JSON tree from `getDocument`), the editors, mermaid, and `builtins/`                                                                                                 |
| `client/design/`       | The design tokens and primitives the UI is built from                                                                                                                                                                                                                                                    |
| `client/builtins/`     | One file per builtin component, exporting the component as default                                                                                                                                                                                                                                       |
| `shared/builtins/`     | One file per builtin's zod props schema, imported by both the client and the server's document parser                                                                                                                                                                                                    |
| `tests/`               | Mirrors `src/` module by module, plus `client/` and `docs/`                                                                                                                                                                                                                                              |
| `example/`             | The tour folder `yarn dev` serves; also a fixture for tests                                                                                                                                                                                                                                              |
| `skills/mdxserve/`     | The agent writing skill `mdxserve setup` installs                                                                                                                                                                                                                                                        |
| `skills/mdxserve-run/` | The agent skill for running the server (`mdxserve:run`), which `mdxserve setup` also installs                                                                                                                                                                                                            |
| `scripts/`             | `build.ts` (the build sequence), `build-registry.ts` (the builtins' zod schemas → `dist/registry.json`), `dev.ts` and `dev-shell.ts` (`yarn dev`), and `smoke-pack.sh` (`yarn smoke`)                                                                                                                    |
| `docs/`                | These pages and the README screenshots                                                                                                                                                                                                                                                                   |

The shape in one line: an adapter (`src/api/`, `src/cli/`, `src/http/`) constructs
the service it needs inline with concrete values, calls one method, and maps the result union
to its transport's error. There is no container, factory, or dependency bag; per-process state
(the doc cache, the search index, the per-file save lock, the roots set, the server lock) is created
once in `startServer` or a CLI command and carried in the request context. `AGENTS.md`
has the full rules.

## Adding a builtin component

1. Create `shared/builtins/<name>.ts` exporting a zod object `<name>Props` describing the
   props, with `.describe()` on each so the registry and `mdxserve components show` can
   explain them. Add it to `shared/builtins/index.ts`, which the server's document parser
   reads to check props.
2. Create `client/builtins/<Name>.tsx` exporting the component as default, typed with the
   inferred props from the shared schema.
3. Register it in `client/builtins/index.ts` with a `description` and a `whenToUse` — the
   latter is what an agent reads to decide whether to reach for it.
4. `yarn registry` (or `yarn build`) regenerates `dist/registry.json`; `mdxserve validate`'s
   unknown-component and unknown-prop checks and the CLI all read from it.
5. A new browser dependency goes in `devDependencies`: the client build bundles it, and the
   published package installs only what the server imports (`yarn build` fails when the
   server imports a package missing from `dependencies`).
6. Show it in `example/06-builtins.mdx` (or `07-charts.mdx` for anything that draws data),
   and add a test under `tests/components/`.

## Releasing

The first `@karimsa/mdxserve` release needs an authenticated `npm publish --access public`.
npm only lets a trusted publisher be configured after the package exists. Once it does,
configure the package's Trusted Publisher setting on npmjs.com for the `karimsa/mdxserve`
repository and `.github/workflows/release.yml`. Later releases use npm trusted publishing
(OIDC, with provenance), with no npm token in the repo:

1. Bump `version` in `package.json` and merge it into `main`.
2. Tag that commit and push the tag:

```bash
git tag v0.1.1 main
git push origin v0.1.1
```

The workflow checks that the tag matches `package.json`, runs the same checks as
`verify-pr.yml`, builds, runs `yarn smoke`, and publishes.

A prerelease version such as `0.6.0-rc.1` (tag `v0.6.0-rc.1`) is a release candidate. The
workflow publishes it to npm under the `next` dist-tag, so `npm install @karimsa/mdxserve`
still resolves to the latest stable release and `npm install @karimsa/mdxserve@next` gets the
candidate. A candidate does not promote the site and gets no `CHANGELOG.md` entry; its changes
are listed under the stable release that follows.

## Tests

Tests mirror the modules: `tests/<module>/service.test.ts`, `service.property.test.ts`,
`controller.test.ts`, `controller.property.test.ts`; adapters get `tests/api/`, `tests/cli/`,
`tests/http/`, `tests/servers/`, `tests/realtime/`. Every service has functional tests for its
behaviour and property tests for the guarantees its interface makes. The client's document
renderer has its own tests under `tests/client/` (`document-view.test.ts`: every node type,
tab reveal, anchors, and that a refetch of identical JSON renders nothing).

Anything that starts a server in a test must point `MDXSERVE_HOME` (and
`MDXSERVE_CACHE_HOME`) at a scratch directory. Only one server runs per user, so a test that
uses the default home collides with — or worse, takes down — the developer's real one.

## Pull requests

The template in `.github/pull_request_template.md` asks for what changed, where to look, screenshots, and a
test plan. Screenshots of the working feature are expected for anything visible; the manual
test plan lists what was actually verified, not what could be.
