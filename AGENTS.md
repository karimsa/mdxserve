## Working with mdxserve

- Every worktree will automatically run `yarn` to update dependencies and make sure the build is ready to go
- Run `yarn dev` to start a dev server - it will automatically pick a random port if it cannot use its default port
- Use claude-in-chrome to test the visual interactivity and rendering in a browser by navigating over to the dev server's port

## Architecture

The backend is hexagonal: domain modules in the middle, adapters at the edges. An adapter
only ever reaches the domain through a service, and a service never knows which adapter is
calling it.

### Domain modules

Each top-level folder in `src/` with a `service.ts` is a domain module: `roots/`, `docs/`,
`listing/`, `search/`, `validation/`, `trash/`, `components/`.

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
  spreads into the aggregate router, and exports its schemas so `src/mcp/` can reuse them
  instead of keeping a second copy.
- Pure helpers stay plain exported functions in their own files (`roots/paths.ts`,
  `docs/edit.ts`, `listing/tree.ts`, …). Write a class only when there is a dependency to hold
  or state to own — never wrap a pure function in one for symmetry.

### No container

There is no service registry, factory, or dependency-injection bag. An adapter `new`s the
service it needs, inline, with the values it already has; a stateless service may be
constructed per request, and two adapters constructing the same service is fine. Only
genuinely per-process state is created once — in `startServer` (`src/http/start.ts`) or the
`mcp` CLI command — and carried through the request context: `DocCache`, `SearchService`,
`DocsService` (it owns the per-file save lock), `RenderService` (it owns the render worker),
`RootsService` (it owns the mutable set of mounted roots and its change hook), `ServerLock`,
and `ServerRegistry`. Anything that is per-request rather than per-process — whether the caller
is on loopback, and so whether the render step may run (`allowRender`) or a root mutation may
run (`allowMutation`) — is a method argument, not a constructor argument.

### Adapters

Adapters contain no business logic:

| Folder           | Role                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/api/`       | tRPC init, `ApiContext`, the `procedure()` factory, and the aggregate router (`router({ ...listingController, … })`)                                               |
| `src/mcp/`       | MCP tools (`tools/*.ts`), one per file; they call the same services the tRPC procedures do, so a tool and a procedure cannot drift                                 |
| `src/http/`      | the node `http` request handler, `startServer`, and the HTML shell                                                                                                 |
| `src/rendering/` | Vite dev server, the SSR render worker, and the MDX compile pipeline                                                                                               |
| `src/servers/`   | the pid lockfile that keeps one server per user, the sqlite record of that server (pid, port, roots), and the tRPC client the CLI and stdio bridge use to reach it |
| `src/infra/`     | package root and cache-dir helpers                                                                                                                                 |
| `src/index.ts`   | the commander CLI                                                                                                                                                  |

`client/` may only `import type` from `src/` (nothing under `src/` is served to the browser);
today that is a single `import type { AppRouter } from "../src/api/router"`.

## General philosophy

- Every service should be cognizant of its service boundaries, revalidating assumptions across boundaries
- All HTTP API methods made available should be strongly typed on both input parameters and result, using zod, ensuring we have both compile-time and runtime type safety
- All HTTP API methods should be GET or POST methods, written as RPC methods (i.e. `getEntityById` vs. `/entity/:id`)
- Never use single-letter variable names, even for small things like `.map(e => e)` or try/catch
  statements. `yarn lint` enforces this (`eslint/id-length`); the only exceptions are `_` for a
  binding you deliberately ignore, and `x`/`y` for a coordinate pair. Property names are not
  checked — `{ opacity: 0, y: 4 }` is a framer-motion key, not a name we chose

## Writing tests

- Tests mirror the modules: `tests/<module>/service.test.ts`, `service.property.test.ts`, `controller.test.ts`, `controller.property.test.ts`; adapters get `tests/api/`, `tests/mcp/`, `tests/http/`, `tests/servers/`, `tests/rendering/`
- Every service should have a set of property tests that validate the guarantees provided by the interface
- Every service should have tests that validate its core functionality
- A service that owns an external process (`RenderService`) may lean on functional tests plus one cheap property; a full property run against a live Vite server is not worth the wall clock

## Creating PRs

- You must use claude-in-chrome to take screenshots of the working functionality and upload it into the PR description
