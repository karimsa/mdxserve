## Working with mdxserve

- Every worktree will automatically run `yarn` to update dependencies and make sure the build is ready to go
- Run `yarn dev` to start a dev server - it will automatically pick a random port if it cannot use its default port
- Use claude-in-chrome to test the visual interactivity and rendering in a browser by navigating over to the dev server's port

## General philosophy

- The backend should be written as a set of individual 'service' classes, following the single responsibility principle
- Every service should be cognizant of its service boundaries, revalidating assumptions across boundaries
- All HTTP API methods made available should be strongly typed on both input parameters and result, using zod, ensuring we have both compile-time and runtime type safety
- All HTTP API methods should be GET or POST methods, written as RPC methods (i.e. `getEntityById` vs. `/entity/:id`)
- The HTTP API is the tRPC router in `src/api/router.ts`; every procedure is built with `procedure("<description>")` so it must say what it is for. `client/` may only `import type` from `src/` (nothing under `src/` is served to the browser)
- Never use single-letter variable names, even for small things like `.map(e => e)` or try/catch statements

## Writing tests

- Every service should have a set of property tests that validate the guarantees provided by the interface
- Every service should have tests that validate its core functionality

## Creating PRs

- You must use claude-in-chrome to take screenshots of the working functionality and upload it into the PR description
