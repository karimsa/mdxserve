# Site deployment

The site is a static Vite and React app in `apps/site/`, the private `@mdxserve/site` workspace. It shares the repository's root `yarn.lock`, but nothing in it is part of what mdxserve publishes to npm. It imports nothing from the other workspaces and needs no mdxserve server.

To work on it locally:

```bash
yarn install                            # at the repository root
yarn workspace @mdxserve/site dev       # dev server
yarn workspace @mdxserve/site build     # typecheck, then write static files to apps/site/dist/
yarn workspace @mdxserve/site preview   # serve apps/site/dist/
```

## How Vercel builds it

Vercel builds the site from the connected Git repository. The project Root Directory is `.`, and the root `vercel.json` sets the build:

- `framework` is `null` (no framework preset), so Vercel serves the output as static files.
- `installCommand` runs `corepack yarn install --immutable` at the repository root, so the Yarn version comes from the root `package.json`'s `packageManager` field.
- `buildCommand` runs `corepack yarn workspace @mdxserve/site build`.
- `outputDirectory` is `apps/site/dist`.
- `ignoreCommand` runs `node scripts/vercel-ignore-build.ts`, which decides whether a commit builds at all (see below).
- A catch-all rewrite sends every path that is not a built file to `index.html`, and the app routes on the client.
- Redirects send the old `/srv/docs/*.mdx` addresses to the matching pages.

A push to the production branch (`main`) starts a production deployment, but its custom production domains remain unassigned until the release workflow promotes it.

### Which commits build

Vercel runs the `ignoreCommand` in its shallow clone before installing anything. Exit code 0 skips the build and Vercel marks the deployment `CANCELED`; exit code 1 builds it. The script, `scripts/vercel-ignore-build.ts` (tests in `tests/automation/vercel-ignore-build.test.ts`), works like this:

- Every `main` commit builds. The release workflow promotes the production deployment of the tagged commit, and a release commit changes only the server's version and the changelog.
- On any other branch, it compares the commit with the branch's last successful deployment (`VERCEL_GIT_PREVIOUS_SHA`). It builds if any of these changed: `apps/site/**`, `vercel.json`, `.vercelignore`, the root `package.json`, `yarn.lock`, `.yarnrc.yml`, `.yarn/**`, or a workspace's `package.json`. The site imports nothing from the other workspaces, but the root install reads all of these. A commit that changes nothing else skips.
- It builds when that previous commit is unknown: on a branch's first deployment, after a force push removed it, or when it is older than the clone. It also builds a redeploy of the same commit, and it builds if the script itself fails.

A skipped deployment stops before the install and the build, but Vercel still counts it toward the daily deployment limit and its concurrent builds. Only Vercel's automatic skipping of unaffected monorepo projects avoids that, and it needs the project's Root Directory to be the site's workspace, not `.`.

## Promotion

Each pushed `v*` tag first runs the npm release job. Once npm publish succeeds, the workflow waits up to 15 minutes for a `READY` Vercel production deployment with the tag's exact commit SHA. Promotion jobs queue one at a time. The job checks the commit currently serving `mdxserve.karim.build` and skips an older or already-current tag; missing or unrelated commit metadata fails the job. For a newer tag, the job promotes the deployment it found and waits until the production domain serves it. The tag must point to a commit on the configured production branch. A failed publish, failed build, mismatched commit, or missing deployment prevents promotion. A release candidate tag (a prerelease version such as `v0.6.0-rc.1`) publishes to npm only: the promotion job is skipped and the live site stays on the last stable release.

The scripts the workflow runs are in `apps/site/deployment/`. Their tests run in the Verify PR workflow and before every release with `node --test apps/site/deployment/*.test.mjs`.

## One-time Vercel setup

1. Connect this Git repository to a Vercel project. Set its Root Directory to `.` and its production branch to `main`. Keep Git deployments enabled. Use Node.js 24.x for builds; the build relies on the Corepack that ships with Node.
2. Leave the project's **Ignored Build Step** on its default (Automatic); the `ignoreCommand` in `vercel.json` overrides it. Keep **Automatically expose System Environment Variables** enabled: without them the script cannot see the previous deployment and builds every commit.
3. In the project's Production environment settings, disable **Auto-assign Custom Production Domains**. Vercel can then build each `main` commit without moving the live domain; the release workflow assigns it only after npm publish succeeds.
4. Add a project-scoped `VERCEL_TOKEN` as a GitHub Actions repository secret with access to the project. Add `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as repository variables, using the IDs from Vercel project settings or `.vercel/project.json`. The workflow uses Vercel's team-scoped REST API to promote the deployment and verify the production alias; the Vercel CLI requires a user lookup that a project-scoped token cannot satisfy. The workflow fails if a value is missing.
5. Configure `mdxserve.karim.build` as the project's production domain. Before the first tagged release, assign the domain to a production deployment whose commit is an ancestor of that release tag; a PR-branch deployment may be unrelated after a squash merge. The freshness check fails closed if the domain has no current deployment or its commit is unrelated. If the domain changes, update it in `apps/site/deployment/check-promotion-freshness.mjs` and in the canonical and Open Graph links in `apps/site/index.html`.

Before a tagged release, confirm that npm trusted publishing is configured for `.github/workflows/release.yml`. The `publish` job runs repository checks, builds, smoke-tests the npm tarball, and publishes with provenance.
