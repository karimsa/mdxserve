# Site deployment

Vercel builds the site from the connected Git repository. The project Root Directory is `.` and the root `vercel.json` routes requests to a container built with `site/Dockerfile.vercel`. A push to the production branch (`main`) starts a production deployment, but its custom production domains remain unassigned until the release workflow promotes it. The `/` redirect opens `/srv/docs/README.mdx`.

Each pushed `v*` tag first runs the npm release job. Once npm publish succeeds, the workflow waits up to 15 minutes for a `READY` Vercel production deployment with the tag's exact commit SHA, then promotes that deployment. The tag must point to a commit on the configured production branch. A failed publish, failed build, mismatched commit, or missing deployment prevents promotion. The workflow does not upload a second copy of the site.

## One-time Vercel setup

1. Connect this Git repository to a Vercel project. Set its Framework Preset to **Services**, Root Directory to `.`, and production branch to `main`. Keep Git deployments enabled.
2. Set the project's **Ignored Build Step** command to `node site/deployment/prepare-context.mjs; exit 1`. The script stages the checked-out source in the Docker build context; `exit 1` tells Vercel to continue building. Keep this project setting enabled for every deployment.
3. In the project's Production environment settings, disable **Auto-assign Custom Production Domains**. Vercel can then build each `main` commit without moving the live domain; the release workflow assigns it only after npm publish succeeds.
4. Add `VERCEL_TOKEN` as a GitHub Actions repository secret with access to the project. Add `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as repository variables, using the IDs from Vercel project settings or `.vercel/project.json`. The workflow fails if a value is missing.
5. Configure the project's production domain and set `PORT=8080` in both Production and Preview. If you use a custom domain, set `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` to a comma-separated list such as `.vercel.app,docs.example.com`, substituting your exact hostname. Do not use a broad public suffix such as `.com`.

The container starts mdxserve in restricted, read-only mode. Its writable state and cache live under `/tmp` because Vercel function filesystems are ephemeral. Vercel builds a nested Dockerfile with `site/` as its context. The project Ignored Build Step first copies the checked-out package, source, scripts, and client into `site/.build-source/`; the Dockerfile fails if that staging step did not finish. The image's package and docs come from the same checkout without waiting for npm registry propagation.

Before a tagged release, confirm that npm trusted publishing is configured for `.github/workflows/release.yml`. The `publish` job runs repository checks, builds, smoke-tests the npm tarball, and publishes with provenance. To check the container locally, run `node site/deployment/prepare-context.mjs` followed by `docker build -f site/Dockerfile.vercel site` from the repository root. This does not deploy the site.
