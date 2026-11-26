# Site deployment

The site is a static Vite and React app in `site/`. It has its own `package.json` and `yarn.lock` and is not a workspace of the mdxserve package, so it never affects what mdxserve publishes to npm. It imports nothing from `src/` or `client/` and needs no mdxserve server.

To work on it locally:

```bash
cd site
yarn install
yarn dev        # dev server
yarn build      # typecheck, then write static files to site/dist/
yarn preview    # serve site/dist/
```

## How Vercel builds it

Vercel builds the site from the connected Git repository. The project Root Directory is `.`, and the root `vercel.json` sets the build:

- `framework` is `null` (no framework preset), so Vercel serves the output as static files.
- `installCommand` runs `corepack yarn install --immutable` in `site/`, so the Yarn version comes from `site/package.json`'s `packageManager` field.
- `buildCommand` runs `corepack yarn build` in `site/`.
- `outputDirectory` is `site/dist`.
- A catch-all rewrite sends every path that is not a built file to `index.html`, and the app routes on the client.
- Redirects send the old `/srv/docs/*.mdx` addresses to the matching pages.

A push to the production branch (`main`) starts a production deployment, but its custom production domains remain unassigned until the release workflow promotes it.

## Promotion

Each pushed `v*` tag first runs the npm release job. Once npm publish succeeds, the workflow waits up to 15 minutes for a `READY` Vercel production deployment with the tag's exact commit SHA. Promotion jobs queue one at a time. The job checks the commit currently serving `mdxserve.karim.build` and skips an older or already-current tag; missing or unrelated commit metadata fails the job. For a newer tag, the job promotes the deployment it found and waits until the production domain serves it. The tag must point to a commit on the configured production branch. A failed publish, failed build, mismatched commit, or missing deployment prevents promotion. A release candidate tag (a prerelease version such as `v0.6.0-rc.1`) publishes to npm only: the promotion job is skipped and the live site stays on the last stable release.

The scripts the workflow runs are in `site/deployment/`. Their tests run in the Verify PR workflow and before every release with `node --test site/deployment/*.test.mjs`.

## One-time Vercel setup

1. Connect this Git repository to a Vercel project. Set its Root Directory to `.` and its production branch to `main`. Keep Git deployments enabled. Use Node.js 22.x for builds; the build relies on the Corepack that ships with Node.
2. Leave the project's **Ignored Build Step** empty (or set it to the default), so every commit builds.
3. In the project's Production environment settings, disable **Auto-assign Custom Production Domains**. Vercel can then build each `main` commit without moving the live domain; the release workflow assigns it only after npm publish succeeds.
4. Add a project-scoped `VERCEL_TOKEN` as a GitHub Actions repository secret with access to the project. Add `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as repository variables, using the IDs from Vercel project settings or `.vercel/project.json`. The workflow uses Vercel's team-scoped REST API to promote the deployment and verify the production alias; the Vercel CLI requires a user lookup that a project-scoped token cannot satisfy. The workflow fails if a value is missing.
5. Configure `mdxserve.karim.build` as the project's production domain. Before the first tagged release, assign the domain to a production deployment whose commit is an ancestor of that release tag; a PR-branch deployment may be unrelated after a squash merge. The freshness check fails closed if the domain has no current deployment or its commit is unrelated. If the domain changes, update it in `site/deployment/check-promotion-freshness.mjs` and in the canonical and Open Graph links in `site/index.html`.

Before a tagged release, confirm that npm trusted publishing is configured for `.github/workflows/release.yml`. The `publish` job runs repository checks, builds, smoke-tests the npm tarball, and publishes with provenance.
