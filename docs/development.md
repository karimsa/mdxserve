# Developing mdxserve

How to build, test, and change mdxserve itself. The rules the code follows — the hexagonal
layout, what a service may and may not import, how tests are organised — live in
[`AGENTS.md`](../AGENTS.md), which is written for coding agents but is the architecture
reference for people too. This page is the practical layer on top of it.

## Setup

```bash
git clone git@github.com:karimsa/mdxserve.git
cd mdxserve
./setup.sh
```

`setup.sh` runs `yarn install` and `yarn build`, symlinks `bin/mdxserve` into `~/.local/bin`
(or `/usr/local/bin`) with the current `node` pinned in `.node-path` so the launcher survives
switching Node versions, installs `skills/` with `npx skills add`, and re-run it after
editing anything under `skills/`.

The project has no native modules and is installed with `enableScripts: false`, so a
dependency that needs a postinstall build will not work. Pick a WASM or pure-JS alternative.

For a git worktree, `./worktree-setup.sh` runs `yarn` so the tree is ready to build.

## Day to day

| Command          | What it does                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `yarn dev`       | Rebuilds the component registry and serves `example/` from source with `tsx` (no build needed)                         |
| `yarn build`     | Generates `dist/registry.json`, then bundles the CLI to `dist/cli.js` and the render worker to `dist/render-worker.js` |
| `yarn registry`  | Only the registry step                                                                                                 |
| `yarn typecheck` | `tsc --noEmit`                                                                                                         |
| `yarn lint`      | `oxlint` — includes the no-single-letter-names rule                                                                    |
| `yarn format`    | `prettier --write .` (`format:check` is what CI runs)                                                                  |
| `yarn test`      | `vitest run`                                                                                                           |

CI (`.github/workflows/verify-pr.yml`) runs, in order: `yarn constraints`, `format:check`,
`lint`, `typecheck`, `test`, `build`. Run the same set before opening a PR.

The `mdxserve` on your `PATH` is the built `dist/cli.js`, so a change under `src/` or
`client/` is not visible to it until you `yarn build`. `yarn dev` sees source changes immediately.

## Where things live

| Path               | Contents                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`             | The server: domain modules (`roots/`, `docs/`, `listing/`, `search/`, `validation/`, `trash/`, `components/`, `export/`) and adapters (`api/`, `cli/`, `http/`, `rendering/`, `servers/`, `infra/`); `index.ts` is the CLI |
| `client/`          | The browser app: the shell, the doc view, the section editor, mermaid, and `builtins/`                                                                                                                                     |
| `client/design/`   | The design tokens and primitives the UI is built from                                                                                                                                                                      |
| `client/builtins/` | One file per builtin component, each exporting the component and its zod props schema                                                                                                                                      |
| `tests/`           | Mirrors `src/` module by module, plus `client/` and `docs/`                                                                                                                                                                |
| `example/`         | The tour folder `yarn dev` serves; also a fixture for tests                                                                                                                                                                |
| `skills/mdxserve/` | The agent writing skill `setup.sh` installs                                                                                                                                                                                |
| `scripts/`         | `build-registry.ts`, which turns the builtins' zod schemas into `dist/registry.json`                                                                                                                                       |
| `docs/`            | These pages and the README screenshots                                                                                                                                                                                     |

The shape in one line: an adapter (`src/api/`, `src/cli/`, `src/http/`) constructs
the service it needs inline with concrete values, calls one method, and maps the result union
to its transport's error. There is no container, factory, or dependency bag; per-process state
(the doc cache, the search index, the render worker, the roots set, the server lock) is created
once in `startServer` or a CLI command and carried in the request context. `AGENTS.md`
has the full rules.

## Adding a builtin component

1. Create `client/builtins/<Name>.tsx` exporting the component as default and a zod object
   `<name>Props` describing its props, with `.describe()` on each so the registry and
   `mdxserve components show` can explain them.
2. Register it in `client/builtins/index.ts` with a `description` and a `whenToUse` — the
   latter is what an agent reads to decide whether to reach for it.
3. `yarn registry` (or `yarn build`) regenerates `dist/registry.json`; `mdxserve validate`'s
   unknown-component and unknown-prop checks and the CLI all read from it.
4. If the component pulls in a new browser dependency, add it to the `optimizeDepsInclude`
   list in `src/rendering/vite.ts`, or its hooks throw on first load.
5. Show it in `example/06-builtins.mdx` (or `07-charts.mdx` for anything that draws data),
   and add a test under `tests/components/`.

## Tests

Tests mirror the modules: `tests/<module>/service.test.ts`, `service.property.test.ts`,
`controller.test.ts`, `controller.property.test.ts`; adapters get `tests/api/`, `tests/cli/`,
`tests/http/`, `tests/servers/`, `tests/rendering/`. Every service has functional tests for its
behaviour and property tests for the guarantees its interface makes. The one exception is a
service that owns an external process (`RenderService`): functional tests plus a single cheap
property, since a full property run against a live Vite server is not worth the wall clock.

Anything that starts a server in a test must point `MDXSERVE_HOME` (and
`MDXSERVE_CACHE_HOME`) at a scratch directory. Only one server runs per user, so a test that
uses the default home collides with — or worse, takes down — the developer's real one.

## Pull requests

The template in `.github/pull_request_template.md` asks for what changed, where to look, screenshots, and a
test plan. Screenshots of the working feature are expected for anything visible; the manual
test plan lists what was actually verified, not what could be.
