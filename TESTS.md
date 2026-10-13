# Test inventory and feature coverage

This audit covers **135 test files and 893 declared cases** across `tests/` and `site/deployment/` on main 0.5.0 plus this PR. A generated or parameterized declaration may run many examples; `yarn test` currently runs over a thousand Vitest examples. Filenames describe the behavior under test, including generated cases, instead of labeling a testing technique. Run the service suite with `yarn test`, the browser journeys with `yarn test:browser` after installing Chromium, and the Node deployment and review-gate tests through the PR workflow.

## Assessment

The strongest checks exercise observable contracts with real files or protocol responses: saves and conflicts, root containment and persistence, listing, origin and permission checks, search indexing, metadata serialization, server locks, and render recovery. Fakes belong at an external port, such as a bundle function, command runner, or diagram provider, while a separate test exercises the real adapter or user flow.

This PR removes checks tied to CSS directive counts, a Vite config array, punctuation in metadata, old CLI wording, a `readSync` spy, and a planner used as its own expected result. It removes a vacuous export exception assertion. The trash controller fake moves files to a recovery directory and verifies retained bytes. The UI and service limit bulk trash to documents. Paired `.md`/`.mdx` cases now require the same validation behavior, and the browser suite opens real standalone exports.

| Surface                                                                                                          | Audit decision                            | Why                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Save, roots, search, HTTP permissions, and metadata service tests                                                | Keep                                      | They assert outputs, durable files, or protocol results that callers can observe.                                          |
| Bundle, command-runner, diagram-provider, and trash-port fakes                                                   | Keep at those boundaries                  | They stand in for an external operation; separate browser, smoke, or adapter tests exercise the real path where practical. |
| Diagram dialog's Mermaid-render stub                                                                             | Keep for dialog state only                | It cannot establish that a converted diagram actually previews or inserts; that remains an acceptance gap.                 |
| Typed-table model and server-rendered markup checks                                                              | Keep for calculations and initial content | They cannot establish that a reader can sort, filter, and persist settings with the controls.                              |
| CSS counts, Vite array shape, file-read spy, wording/punctuation, planner-as-oracle, and vacuous exception check | Remove or replace                         | These either tested a replaceable implementation choice or could pass without verifying a result.                          |

### Remaining weak spots

- Diagram dialog tests stub Mermaid rendering. They verify conversion state and cancellation, while no browser journey yet proves a generated diagram actually previews and inserts correctly.
- Typed table model and server-rendered markup have extensive tests, but no browser journey yet proves sorting, filtering, and saved table settings through user controls.
- OS Trash recovery, a remote network client, native save-picker cancellation, and a real diagram-provider conversion need dedicated host or credential environments. The local suite covers adjacent service/API outcomes.
- Search tests do not promise an order among equal scores. Add a tie-order acceptance case only if the product promises that order.

## Feature acceptance record

Each row names a user-visible behavior and the evidence for it. **Partial** identifies an acceptance journey still worth testing. Private state, CSS structure, hook calls, and helper call order are not feature guarantees.

| ID  | Feature                               | Current acceptance coverage                                                                                                                                                                                                                                                  | Remaining surface                                                                          |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| F01 | Starting and finding a server         | Browser suite starts the CLI, reads `status` and `status --json`, rejects a duplicate, and confirms the first server responds.                                                                                                                                               | Zero-root startup and busy-port fallback through the CLI.                                  |
| F02 | Live root changes                     | Browser suite adds a root, sees it in the viewer, removes the open document's root, and reaches the remaining root.                                                                                                                                                          | Initial zero-root viewer becoming populated.                                               |
| F03 | Browser navigation                    | Browser suite follows document links, Back/Forward, table of contents, and next-page link.                                                                                                                                                                                   | —                                                                                          |
| F04 | Live file changes                     | Browser suite sees an external edit and folder add/rename without reload.                                                                                                                                                                                                    | Removal from an open folder and change toast.                                              |
| F05 | In-place section editing              | Browser suite saves with the keyboard, checks disk bytes, and cancels with Escape; service tests cover stale versions and invalid content.                                                                                                                                   | Browser feedback for concurrent and invalid saves.                                         |
| F06 | Recoverable bulk trash                | Browser suite selects documents and cancels without a write; service/controller tests partition failures and retain moved bytes.                                                                                                                                             | Real OS Trash recovery and mixed-result UI.                                                |
| F07 | `.md` and `.mdx` parity               | Paired validation covers GFM, JSX, imports, ESM comparisons, multiline expressions, literal `<`, regex and division expressions, JSX attributes, unmatched and escaped backticks, fenced code, and malformed source; browser journeys include uppercase document extensions. | Paired edit and export journey.                                                            |
| F08 | Standalone export                     | Browser suite runs the CLI without a server and opens `file://` HTML with a table and working Tabs.                                                                                                                                                                          | Relative images, code styling, Mermaid modes, and layout settings in the exported file.    |
| F09 | Viewer export                         | Browser suite downloads from the top bar and opens saved HTML.                                                                                                                                                                                                               | Native picker cancellation and failed-build destination preservation.                      |
| F10 | LAN read and local privileges         | HTTP/controller tests cover origin, host, caller locality, and permission policy.                                                                                                                                                                                            | Real remote-interface connection with reads allowed and mutations/render denied.           |
| F11 | Viewer search                         | Browser suite filters body text and opens a result with Enter; service tests cover indexing and excerpts.                                                                                                                                                                    | Arrow/Escape keys and across-root results.                                                 |
| F12 | Folder listing                        | Browser suite proves non-doc files cannot be selected for trash and cancellation preserves bytes.                                                                                                                                                                            | Visible sort and age selection journey.                                                    |
| F13 | Reader navigation                     | Browser suite follows table of contents and next-page card.                                                                                                                                                                                                                  | Breadcrumb and active-heading scroll tracking.                                             |
| F14 | Rich document display                 | Browser suite checks a table and Callout in live reader and standalone file.                                                                                                                                                                                                 | Syntax highlighting, images, and visible error states.                                     |
| F15 | Custom components                     | Browser suite imports a neighboring component in both extensions.                                                                                                                                                                                                            | Local name overriding a builtin.                                                           |
| F16 | Interactive builtins and diagrams     | Browser suite switches Tabs in live and standalone readers; diagram rendering has service/component tests.                                                                                                                                                                   | Mermaid fullscreen, code, and direction controls in a browser.                             |
| F17 | Reader preferences and print          | Browser suite persists dark mode and checks print media; preference and standalone settings tests cover stored choices.                                                                                                                                                      | Reader width, layout persistence across navigation/restart, and reduced-motion navigation. |
| F18 | Agent-facing commands                 | Browser suite runs `cache clean` twice; package smoke runs installed commands.                                                                                                                                                                                               | Safe real `setup` rerun in a controlled tool environment.                                  |
| F19 | Persistent roots                      | Root config tests cover read/write validation and watched updates to mounted roots.                                                                                                                                                                                          | CLI restart retaining mounted roots and an external config edit in an open viewer.         |
| F20 | Frontmatter and page metadata         | Docs, HTTP, rendering, search, client-head, and export tests cover YAML and metadata; a browser journey checks initial HTML and `.md` to `.mdx` navigation.                                                                                                                  | Standalone metadata in an opened `file://` export.                                         |
| F21 | Typed interactive tables              | Client tests cover numeric ranges, sorting/filtering, column configuration, server markup, and saved table state.                                                                                                                                                            | Browser sort/filter and persistence journey.                                               |
| F22 | Diagram authoring                     | Dialog, diagram service/controller, and adapter tests cover provider selection, revisions, cancellation, validation, and image ownership.                                                                                                                                    | Browser conversion, preview, insertion, and direct edit with a controlled provider.        |
| F23 | Layout preferences                    | Preference and standalone settings tests cover saved width/layout choices and export initialization.                                                                                                                                                                         | Browser setting controls, persistence, and standalone presentation.                        |
| F24 | Restricted reader mode                | HTTP/controller and client tests cover blocked writes and a read-only UI even for a loopback caller.                                                                                                                                                                         | Start a restricted instance and prove read/search access and denied actions in a browser.  |
| F25 | Hosted site and deployment safety     | Immutable-site rendering and Node deployment tests cover site assets, project-token promotion, alias selection, and current production detection.                                                                                                                            | Hosted navigation and localhost denial through a running site container.                   |
| F26 | Slash insertion and component editing | Client editor tests cover template insertion, component fields, source round trip, and edit controls.                                                                                                                                                                        | Browser insertion, save, reload, and component edit journey.                               |
| F27 | CLI update notices                    | CLI tests cover cached notice display, command flags, noninteractive and environment suppression, and optional notifier failure.                                                                                                                                             | End-to-end installed CLI behavior without registry access.                                 |
| F28 | PR approval and review gates          | Node tests cover maintainer decisions and current-head Codex review evidence before checks pass.                                                                                                                                                                             | GitHub workflow behavior when reviews or the PR head change mid-run.                       |

## Complete case inventory

Each bullet links to its declaration in the current source. Parameterized and generated declarations may execute more than one runtime case. The inventory lists promises rather than the testing technique.

### site

#### [check-promotion-freshness.test.mjs](site/deployment/check-promotion-freshness.test.mjs) (8 declarations)

- [promotes only when the live production commit is an ancestor](site/deployment/check-promotion-freshness.test.mjs#L55)
- [skips an already-current or older queued release](site/deployment/check-promotion-freshness.test.mjs#L78)
- [accepts the current commit from Vercel metadata when gitSource is omitted](site/deployment/check-promotion-freshness.test.mjs#L101)
- [fails closed when production is unrelated or has missing metadata](site/deployment/check-promotion-freshness.test.mjs#L109)
- [rejects Vercel authorization failures](site/deployment/check-promotion-freshness.test.mjs#L146)
- [recovers from rate limiting while looking up the production alias](site/deployment/check-promotion-freshness.test.mjs#L153)
- [recovers from server and network failures while looking up the live deployment](site/deployment/check-promotion-freshness.test.mjs#L167)
- [fails closed after bounded retries for either production lookup](site/deployment/check-promotion-freshness.test.mjs#L187)

#### [promote-production.test.mjs](site/deployment/promote-production.test.mjs) (4 declarations)

- [promotes with the project token and waits until the production domain moves](site/deployment/promote-production.test.mjs#L42)
- [fails before alias polling when promotion is denied](site/deployment/promote-production.test.mjs#L64)
- [fails closed on a mismatched production alias](site/deployment/promote-production.test.mjs#L73)
- [bounds alias polling and never retries the promotion request](site/deployment/promote-production.test.mjs#L82)

#### [wait-for-production.test.mjs](site/deployment/wait-for-production.test.mjs) (7 declarations)

- [waits for the exact production deployment and checks API results independently](site/deployment/wait-for-production.test.mjs#L44)
- [checks later pages before waiting for another poll](site/deployment/wait-for-production.test.mjs#L76)
- [fails for a terminal matching deployment](site/deployment/wait-for-production.test.mjs#L86)
- [ignores the optional legacy state when readyState reports readiness](site/deployment/wait-for-production.test.mjs#L93)
- [uses readyState for terminal failures even when legacy state is absent](site/deployment/wait-for-production.test.mjs#L98)
- [times out without promoting an unrelated deployment](site/deployment/wait-for-production.test.mjs#L103)
- [retries transient HTTP responses but rejects authorization failures](site/deployment/wait-for-production.test.mjs#L114)

### api

#### [router.test.ts](tests/api/router.test.ts) (4 declarations)

- [exposes the documented procedures with descriptions](tests/api/router.test.ts#L64)
- [rejects mutations from a mismatched Origin with FORBIDDEN, but not queries](tests/api/router.test.ts#L81)
- [accepts a matching Origin, an absent Origin, and rejects an unparsable one](tests/api/router.test.ts#L90)
- [restricted policy blocks direct mutation callers even when their context claims loopback](tests/api/router.test.ts#L103)

### automation

#### [changelog.test.ts](tests/automation/changelog.test.ts) (1 declarations)

- [regenerates tagged releases and the requested package version from original subjects](tests/automation/changelog.test.ts#L42)

#### [codex-review-gate.test.cjs](tests/automation/codex-review-gate.test.cjs) (6 declarations)

- [accepts the observed Codex summary for the current commit](tests/automation/codex-review-gate.test.cjs#L19)
- [rejects forged, missing, running, failed, security-only and stale evidence](tests/automation/codex-review-gate.test.cjs#L24)
- [requires the latest summary and rejects ambiguous abbreviated commits](tests/automation/codex-review-gate.test.cjs#L42)
- [publishes success only after checking evidence for the current head](tests/automation/codex-review-gate.test.cjs#L100)
- [stays pending on missing evidence or a concurrent push](tests/automation/codex-review-gate.test.cjs#L108)
- [clears a previous pass before a failed API read](tests/automation/codex-review-gate.test.cjs#L117)

#### [maintainer-approval-gate.test.cjs](tests/automation/maintainer-approval-gate.test.cjs) (9 declarations)

- [requires the latest decisive maintainer review on the exact head](tests/automation/maintainer-approval-gate.test.cjs#L21)
- [accepts the PR author and does not require a review API read](tests/automation/maintainer-approval-gate.test.cjs#L108)
- [accepts current-head approval and resets the check before reading reviews](tests/automation/maintainer-approval-gate.test.cjs#L120)
- [creates a new failing run when a completed approval is invalidated](tests/automation/maintainer-approval-gate.test.cjs#L130)
- [creates a new successful run when a completed failure receives approval](tests/automation/maintainer-approval-gate.test.cjs#L152)
- [fails after dismissal, changed decision, old approval, or no review](tests/automation/maintainer-approval-gate.test.cjs#L172)
- [ignores a check from another app or PR and creates one on the original head](tests/automation/maintainer-approval-gate.test.cjs#L188)
- [clears an old pass before review API failure and does not publish for a moved head](tests/automation/maintainer-approval-gate.test.cjs#L201)
- [checks every open PR serially](tests/automation/maintainer-approval-gate.test.cjs#L213)

### browser

#### [features.test.ts](tests/browser/features.test.ts) (21 declarations)

- [serves and updates frontmatter metadata across Markdown extensions](tests/browser/features.test.ts#L188)
- [renders a neighboring component from both Markdown extensions](tests/browser/features.test.ts#L220)
- [renders multiline comparisons in MDX expressions from both Markdown extensions](tests/browser/features.test.ts#L233)
- [renders expressions and prose around unmatched or escaped backticks in both extensions](tests/browser/features.test.ts#L248)
- [keeps JSX attribute text and uppercase document rendering consistent](tests/browser/features.test.ts#L267)
- [renders ESM comparisons and code fences consistently in both extensions](tests/browser/features.test.ts#L283)
- [updates mounted roots in an open viewer and leaves removed documents](tests/browser/features.test.ts#L301)
- [reports the live server through the executable and refuses a duplicate](tests/browser/features.test.ts#L324)
- [cleans a populated cache through the executable and can be repeated](tests/browser/features.test.ts#L334)
- [renders rich content and switches an interactive tab](tests/browser/features.test.ts#L344)
- [opens a CLI standalone export as a local HTML page](tests/browser/features.test.ts#L359)
- [downloads a viewer export that opens as a local HTML page](tests/browser/features.test.ts#L393)
- [selects only documents for bulk trash and preserves them on cancel](tests/browser/features.test.ts#L420)
- [navigates folders and documents with browser history](tests/browser/features.test.ts#L444)
- [shows a usable route back from a missing document](tests/browser/features.test.ts#L460)
- [uses the table of contents and next page link](tests/browser/features.test.ts#L472)
- [searches by body text and opens the selected result](tests/browser/features.test.ts#L494)
- [saves and cancels an in-place section edit](tests/browser/features.test.ts#L511)
- [updates an open document after an external save](tests/browser/features.test.ts#L543)
- [updates an open folder when a document is added and renamed](tests/browser/features.test.ts#L558)
- [persists a selected theme and hides controls for print](tests/browser/features.test.ts#L579)

### cli

#### [docs.test.ts](tests/cli/docs.test.ts) (8 declarations)

- [lists all roots when unavailable falls back to the local walk](tests/cli/docs.test.ts#L41)
- [lists one directory with the cwd-resolved path in the header](tests/cli/docs.test.ts#L51)
- [fails for a directory outside every root](tests/cli/docs.test.ts#L60)
- [rejects --depth %j](tests/cli/docs.test.ts#L65)
- [prefers a remote ok result and passes the resolved dir and depth](tests/cli/docs.test.ts#L71)
- [fails with the message on a remote error](tests/cli/docs.test.ts#L88)
- [reports no server and no roots](tests/cli/docs.test.ts#L98)
- [--json prints { roots }](tests/cli/docs.test.ts#L113)

#### [format.test.ts](tests/cli/format.test.ts) (12 declarations)

- [prints nothing extra when there are no hints](tests/cli/format.test.ts#L23)
- [prints each hint as a `hint:` line after the render status, on an OK result](tests/cli/format.test.ts#L27)
- [keeps hints after the diagnostics on a failing result](tests/cli/format.test.ts#L33)
- [reports a clean render](tests/cli/format.test.ts#L46)
- [reports a render with errors](tests/cli/format.test.ts#L50)
- [blames the errors, not the server, when static errors stopped the render](tests/cli/format.test.ts#L54)
- [says no server is reachable otherwise](tests/cli/format.test.ts#L63)
- [points readers to the available server and roots commands](tests/cli/format.test.ts#L72)
- [formatDiagnostic appends suggestions](tests/cli/format.test.ts#L79)
- [formatSearchResults handles zero and some hits](tests/cli/format.test.ts#L93)
- [formatDocTree indents nodes and marks empty roots, preferring the header dir](tests/cli/format.test.ts#L101)
- [formatRoots lists name and dir, or says none are served](tests/cli/format.test.ts#L120)

#### [roots.test.ts](tests/cli/roots.test.ts) (6 declarations)

- [add proxies resolved dirs and prints Added / Now serving](tests/cli/roots.test.ts#L10)
- [remove proxies and prints Removed / Now serving: (none)](tests/cli/roots.test.ts#L31)
- [list prints dirs, or (none)](tests/cli/roots.test.ts#L41)
- [unavailable remote and missing server report the no-server message, exit 1](tests/cli/roots.test.ts#L57)
- [surfaces a remote error](tests/cli/roots.test.ts#L71)
- [--json prints the result objects](tests/cli/roots.test.ts#L88)

#### [search.test.ts](tests/cli/search.test.ts) (7 declarations)

- [prefers a remote ok result over the local index](tests/cli/search.test.ts#L37)
- [fails with the message on a remote error](tests/cli/search.test.ts#L47)
- [uses the local index when the remote is unavailable](tests/cli/search.test.ts#L57)
- [zero matches is exit 0](tests/cli/search.test.ts#L64)
- [reports no server](tests/cli/search.test.ts#L71)
- [reports no roots](tests/cli/search.test.ts#L77)
- [--json prints { results }](tests/cli/search.test.ts#L83)

#### [smoke.test.ts](tests/cli/smoke.test.ts) (3 declarations)

- [lists the agent-facing verbs](tests/cli/smoke.test.ts#L8)
- [exposes permissions mode and requires a root for default network access](tests/cli/smoke.test.ts#L22)
- [rejects an unknown permissions mode and full network access without opt-in](tests/cli/smoke.test.ts#L42)

#### [updates.test.ts](tests/cli/updates.test.ts) (4 declarations)

- [shows a cached update notice for an interactive command](tests/cli/updates.test.ts#L38)
- [omits update notices for %s](tests/cli/updates.test.ts#L47)
- [omits update notices for noninteractive output and the environment opt-out](tests/cli/updates.test.ts#L56)
- [keeps the CLI running when the optional notifier fails](tests/cli/updates.test.ts#L65)

#### [validate-results.test.ts](tests/cli/validate-results.test.ts) (3 declarations)

- [exits 1 iff some result has an error-severity diagnostic](tests/cli/validate-results.test.ts#L46)
- [every json entry round-trips validationResultSchema, one per input](tests/cli/validate-results.test.ts#L59)
- [prints one block per input](tests/cli/validate-results.test.ts#L73)

#### [validate.test.ts](tests/cli/validate.test.ts) (15 declarations)

- [validates an absolute path with no server at all, exit 0](tests/cli/validate.test.ts#L64)
- [exits 0 for warnings only and lists them](tests/cli/validate.test.ts#L71)
- [exits 1 for a bad component and prints did you mean](tests/cli/validate.test.ts#L79)
- [reports a pie fence as mermaid-chart](tests/cli/validate.test.ts#L87)
- [falls back to static checks and rejects a file outside every root (stale row)](tests/cli/validate.test.ts#L94)
- [rejects a directory path](tests/cli/validate.test.ts#L103)
- [resolves relative paths against deps.cwd and ~/ against deps.home](tests/cli/validate.test.ts#L109)
- [never renders on the static path](tests/cli/validate.test.ts#L119)
- [prints a remote ok result verbatim, with Rendered OK](tests/cli/validate.test.ts#L127)
- [reports a remote error as Not validated, exit 1](tests/cli/validate.test.ts#L136)
- [fails the whole command when listing roots errors](tests/cli/validate.test.ts#L146)
- [prints blocks separated by a blank line and a summary](tests/cli/validate.test.ts#L157)
- [omits the summary for a single path](tests/cli/validate.test.ts#L176)
- [prints an array whose entries parse with validationResultSchema or carry an error](tests/cli/validate.test.ts#L183)
- [validates through a real RemoteClient and rejects files outside the roots](tests/cli/validate.test.ts#L212)

### client

#### [app-metadata.test.ts](tests/client/app-metadata.test.ts) (3 declarations)

- [preserves all server metadata when the initial document module fails](tests/client/app-metadata.test.ts#L51)
- [uses a successfully loaded module even when it removes server metadata](tests/client/app-metadata.test.ts#L71)
- [clears previous metadata for a failed navigation without server metadata](tests/client/app-metadata.test.ts#L83)

#### [block-state.test.ts](tests/client/block-state.test.ts) (8 declarations)

- [isolates document, block, kind, and format version](tests/client/block-state.test.ts#L45)
- [round-trips validated JSON state without sharing mutable objects](tests/client/block-state.test.ts#L60)
- [encodes paths and IDs without separator collisions](tests/client/block-state.test.ts#L74)
- [ignores invalid saved data: %s](tests/client/block-state.test.ts#L91)
- [migrates legacy keys only when no current value exists](tests/client/block-state.test.ts#L97)
- [tolerates unavailable storage, access failures, and quota errors](tests/client/block-state.test.ts#L109)
- [does not throw or overwrite existing data for unserializable state](tests/client/block-state.test.ts#L124)
- [uses the document context and normalized defaults during server rendering](tests/client/block-state.test.ts#L131)

#### [chart-bins.test.ts](tests/client/chart-bins.test.ts) (16 declarations)

- [bin counts sum to the number of finite values](tests/client/chart-bins.test.ts#L31)
- [puts every finite value in exactly one bin's \[start, end) range (end inclusive on the last)](tests/client/chart-bins.test.ts#L42)
- [has contiguous, monotonic edges spanning \[min, max\]](tests/client/chart-bins.test.ts#L60)
- [uses equal-width bins when the range is non-degenerate](tests/client/chart-bins.test.ts#L75)
- [respects an explicit bin count (clamped to 50) when non-degenerate, else falls back to autoBinCount](tests/client/chart-bins.test.ts#L89)
- [collapses a zero-width range to one bin holding every value](tests/client/chart-bins.test.ts#L109)
- [returns \[\] for values with no finite entries](tests/client/chart-bins.test.ts#L120)
- [gives every bin a non-empty label](tests/client/chart-bins.test.ts#L138)
- [is >= the input, > 0, with an integer mantissa in \[1, 10\]](tests/client/chart-bins.test.ts#L148)
- [is idempotent on integer input](tests/client/chart-bins.test.ts#L166)
- [is strictly increasing from 0 to max, with at most `desired` ticks](tests/client/chart-bins.test.ts#L177)
- [does not depend on label order](tests/client/chart-bins.test.ts#L197)
- [stays within \[min, max\]](tests/client/chart-bins.test.ts#L212)
- [never shrinks when a longer label is added](tests/client/chart-bins.test.ts#L228)
- [returns the label unchanged when it fits, else a prefix of it plus an ellipsis](tests/client/chart-bins.test.ts#L246)
- [is strictly increasing, includes both ends, and stays in range](tests/client/chart-bins.test.ts#L267)

#### [chart-data.test.ts](tests/client/chart-data.test.ts) (18 declarations)

- [passes finite numbers through](tests/client/chart-data.test.ts#L14)
- [falls back to 0 for anything non-finite](tests/client/chart-data.test.ts#L19)
- [rounds up to a leading digit at the value's magnitude](tests/client/chart-data.test.ts#L27)
- [falls back to 1 for non-finite or non-positive input](tests/client/chart-data.test.ts#L32)
- [dedupes ticks that round to the same integer for a small max](tests/client/chart-data.test.ts#L40)
- [spaces five ticks evenly for a larger max](tests/client/chart-data.test.ts#L44)
- [follows Sturges' rule](tests/client/chart-data.test.ts#L50)
- [clamps to 20 for a huge sample](tests/client/chart-data.test.ts#L55)
- [rounds off floating-point noise using the step's precision](tests/client/chart-data.test.ts#L61)
- [bins into equal-width buckets with the last edge pinned to max](tests/client/chart-data.test.ts#L67)
- [keeps rounded edges ordered and counts values in their actual ranges: %j, %i](tests/client/chart-data.test.ts#L74)
- [returns \[\] for an empty or all-NaN input](tests/client/chart-data.test.ts#L101)
- [returns one bin holding everything for a single value](tests/client/chart-data.test.ts#L106)
- [returns one bin of the full count for a zero-width range](tests/client/chart-data.test.ts#L112)
- [respects an explicit bin count, clamped to 50](tests/client/chart-data.test.ts#L118)
- [clamps to the given bounds](tests/client/chart-data.test.ts#L130)
- [leaves a label unchanged when it fits](tests/client/chart-data.test.ts#L143)
- [truncates with an ellipsis when it doesn't fit](tests/client/chart-data.test.ts#L147)

#### [component-fields.test.ts](tests/client/component-fields.test.ts) (2 declarations)

- [edits a literal property without rewriting nested content or expressions](tests/client/component-fields.test.ts#L4)
- [keeps text editable when cleared and handles MDX special characters in %s](tests/client/component-fields.test.ts#L18)

#### [data-table-ranges.test.ts](tests/client/data-table-ranges.test.ts) (3 declarations)

- [numeric sorting preserves all values and produces monotonic order](tests/client/data-table-ranges.test.ts#L10)
- [inclusive numeric filtering agrees with the mathematical interval](tests/client/data-table-ranges.test.ts#L23)
- [duration bounds represent the same amount across display units](tests/client/data-table-ranges.test.ts#L35)

#### [data-table.test.ts](tests/client/data-table.test.ts) (24 declarations)

- [keeps saved numeric duration bounds meaningful when auto display units change](tests/client/data-table.test.ts#L28)
- [infers only consistent units and preserves ambiguous columns as text](tests/client/data-table.test.ts#L32)
- [uses fractional source percentages and percentage-point filters](tests/client/data-table.test.ts#L39)
- [converts duration aliases, explicit units and bare display values to the source unit](tests/client/data-table.test.ts#L44)
- [uses binary bytes and rejects unrecognized units instead of accepting a numeric prefix](tests/client/data-table.test.ts#L51)
- [expands currency suffixes without converting numeric source data to text](tests/client/data-table.test.ts#L57)
- [matches regex case insensitively by default and reports invalid patterns](tests/client/data-table.test.ts#L62)
- [uses inclusive bounds, preserves missing values, and rejects inverted or malformed bounds](tests/client/data-table.test.ts#L68)
- [sorts numbers numerically and keeps missing values last in either direction](tests/client/data-table.test.ts#L76)
- [requires identity, numeric measures, base units and currency formatters](tests/client/data-table.test.ts#L82)
- [forwards native table attributes when no header is recognized (%#)](tests/client/data-table.test.ts#L109)
- [preserves formatted and linked headers in %s](tests/client/data-table.test.ts#L146)
- [forwards attributes to the inner table when reconstructing a recognized header](tests/client/data-table.test.ts#L159)
- [preserves native structure for %s](tests/client/data-table.test.ts#L176)
- [preserves authored attributes on %s descendants](tests/client/data-table.test.ts#L226)
- [keeps identities with heading context when identical-header tables are inserted or moved](tests/client/data-table.test.ts#L240)
- [disables persistence for ambiguous generated identities](tests/client/data-table.test.ts#L253)
- [preserves alignment from native cell attributes](tests/client/data-table.test.ts#L263)
- [preserves explicit GFM alignment independently of inferred types in %s](tests/client/data-table.test.ts#L284)
- [normalizes native duration and byte columns into one display unit](tests/client/data-table.test.ts#L305)
- [renders identical native tables in md and mdx, preserving links and inline formatting](tests/client/data-table.test.ts#L312)
- [preserves native identity across row edits and distinguishes same-header tables](tests/client/data-table.test.ts#L323)
- [does not coerce mixed text or leading-zero identifiers into numbers](tests/client/data-table.test.ts#L333)
- [renders grouped numeric tables in both extensions without client globals](tests/client/data-table.test.ts#L339)

#### [diagram-dialog.test.ts](tests/client/diagram-dialog.test.ts) (15 declarations)

- [debounces rough input, rejects stale previews and permits an identical replacement result](tests/client/diagram-dialog.test.ts#L92)
- [keeps failures visible and pauses automatic retries](tests/client/diagram-dialog.test.ts#L104)
- [ignores an old response after the input changes](tests/client/diagram-dialog.test.ts#L115)
- [waits a full second after the latest edit](tests/client/diagram-dialog.test.ts#L132)
- [flushes immediately on %s without a duplicate conversion](tests/client/diagram-dialog.test.ts#L148)
- [explicitly retries failures with a newer revision](tests/client/diagram-dialog.test.ts#L168)
- [keeps generated source on the left while the diagram stays visible on the right](tests/client/diagram-dialog.test.ts#L181)
- [opens an existing diagram with its source and only converts after it is edited](tests/client/diagram-dialog.test.ts#L197)
- [closes an unchanged existing diagram on an outside click](tests/client/diagram-dialog.test.ts#L234)
- [keeps unsaved input open and nudges again on repeated outside clicks](tests/client/diagram-dialog.test.ts#L249)
- [ignores a drag that starts inside and ends outside the dialog](tests/client/diagram-dialog.test.ts#L264)
- [allows outside dismissal after input is reverted before conversion](tests/client/diagram-dialog.test.ts#L270)
- [keeps a ready draft after rejecting a %s attachment](tests/client/diagram-dialog.test.ts#L279)
- [keeps valid source editable locally when the agent is disabled](tests/client/diagram-dialog.test.ts#L294)
- [never invokes an agent for rough text while disabled](tests/client/diagram-dialog.test.ts#L317)

#### [diagram-direct-edit.test.ts](tests/client/diagram-direct-edit.test.ts) (2 declarations)

- [hides direct editing inside JSX while the following blockquote diagram still opens](tests/client/diagram-direct-edit.test.ts#L66)
- [edits from the rendered page without Tiptap: %s](tests/client/diagram-direct-edit.test.ts#L154)

#### [diagram-edit.test.ts](tests/client/diagram-edit.test.ts) (4 declarations)

- [updates only the selected duplicate diagram and supports one-step undo](tests/client/diagram-edit.test.ts#L19)
- [refuses a stale diagram location or source without changing the document](tests/client/diagram-edit.test.ts#L31)
- [matches highlighted blank-line padding but keeps the original source for editing](tests/client/diagram-edit.test.ts#L40)
- [exposes edit buttons in the section editor without adding them to serialized Markdown](tests/client/diagram-edit.test.ts#L52)

#### [diagram-preferences.test.ts](tests/client/diagram-preferences.test.ts) (9 declarations)

- [shows only the active agent's models and preserves each selection across switches](tests/client/diagram-preferences.test.ts#L60)
- [keeps the saved model when discovery fails](tests/client/diagram-preferences.test.ts#L76)
- [autosaves agent and model changes without closing Settings or writing during load](tests/client/diagram-preferences.test.ts#L90)
- [saves the auto-detected agent without a separate save action](tests/client/diagram-preferences.test.ts#L105)
- [prevents overlapping writes and restores the saved selection after a failure](tests/client/diagram-preferences.test.ts#L113)
- [applies layout changes immediately and keeps them across reopening, independently of diagram writes](tests/client/diagram-preferences.test.ts#L132)
- [defaults to visible contents and autosaves visibility independently of diagram settings](tests/client/diagram-preferences.test.ts#L144)
- [keeps the modal open through every dismissal path until an autosave failure is shown](tests/client/diagram-preferences.test.ts#L160)
- [offers browser-local layout settings to remote viewers without accessing diagram preferences](tests/client/diagram-preferences.test.ts#L190)

#### [diagram-section-editor.test.ts](tests/client/diagram-section-editor.test.ts) (2 declarations)

- [opens a Mermaid-only section directly in the dialog and does not reopen after closing](tests/client/diagram-section-editor.test.ts#L18)
- [allows section cancellation after Tiptap handles Escape to select a parent node](tests/client/diagram-section-editor.test.ts#L45)

#### [diagram-session.test.ts](tests/client/diagram-session.test.ts) (1 declarations)

- [makes unique UUID sessions without secure-context randomUUID](tests/client/diagram-session.test.ts#L4)

#### [diagram-source.test.ts](tests/client/diagram-source.test.ts) (6 declarations)

- [replaces only the selected diagram and preserves surrounding Markdown exactly](tests/client/diagram-source.test.ts#L4)
- [preserves the nesting prefix of a blockquoted diagram](tests/client/diagram-source.test.ts#L14)
- [ignores highlighted blank-line padding without changing the input source](tests/client/diagram-source.test.ts#L21)
- [edits a %s fence terminated by EOF](tests/client/diagram-source.test.ts#L29)
- [closes an EOF fence while preserving nested indentation and trailing newline](tests/client/diagram-source.test.ts#L36)
- [can populate an empty EOF fence](tests/client/diagram-source.test.ts#L45)

#### [doc-module-cache.test.ts](tests/client/doc-module-cache.test.ts) (1 declarations)

- [keeps URL punctuation and Unicode inside the filesystem path during refresh](tests/client/doc-module-cache.test.ts#L5)

#### [editor-link.test.ts](tests/client/editor-link.test.ts) (6 declarations)

- [returns the href for a cmd+click on a link](tests/client/editor-link.test.ts#L13)
- [returns the href for a ctrl+click on a link](tests/client/editor-link.test.ts#L19)
- [leaves a plain click alone so the caret can land inside the link text](tests/client/editor-link.test.ts#L25)
- [ignores clicks that are not the primary button](tests/client/editor-link.test.ts#L29)
- [ignores a modified click that is not on a link](tests/client/editor-link.test.ts#L38)
- [opens only when the primary button carries cmd or ctrl, for any href](tests/client/editor-link.test.ts#L44)

#### [editor-slash-templates.test.ts](tests/client/editor-slash-templates.test.ts) (1 declarations)

- [compile and pass builtin validation in .%s](tests/client/editor-slash-templates.test.ts#L24)

#### [editor-slash.test.ts](tests/client/editor-slash.test.ts) (13 declarations)

- [inserts %s as valid Markdown](tests/client/editor-slash.test.ts#L64)
- [keeps content before and after an insertion](tests/client/editor-slash.test.ts#L87)
- [rejects stale ranges and paragraphs with other text](tests/client/editor-slash.test.ts#L99)
- [has an editable MDX source template for every builtin](tests/client/editor-slash.test.ts#L105)
- [reopens every saved component as the same editable source block](tests/client/editor-slash.test.ts#L122)
- [wraps Tab and Option in valid parents](tests/client/editor-slash.test.ts#L135)
- [matches labels, aliases and descriptions](tests/client/editor-slash.test.ts#L146)
- [keeps a multiword query active](tests/client/editor-slash.test.ts#L152)
- [opens a grouped menu and uses arrows and Enter without losing editor focus](tests/client/editor-slash.test.ts#L161)
- [leaves the slash text for dialog commands and Escape](tests/client/editor-slash.test.ts#L177)
- [opens the %s dialog without deleting the trigger](tests/client/editor-slash.test.ts#L195)
- [inserts Mermaid source when the diagram agent is disabled](tests/client/editor-slash.test.ts#L209)
- [dismisses on Escape and leaves the typed query intact](tests/client/editor-slash.test.ts#L218)

#### [export-filenames.test.ts](tests/client/export-filenames.test.ts) (5 declarations)

- [never contains a path separator and always ends in the target extension](tests/client/export-filenames.test.ts#L18)
- [is idempotent modulo the extension](tests/client/export-filenames.test.ts#L28)
- [equals the last segment's stem plus the target extension](tests/client/export-filenames.test.ts#L38)
- [round-trips arbitrary unicode text through utf8](tests/client/export-filenames.test.ts#L52)
- [round-trips arbitrary bytes through base64](tests/client/export-filenames.test.ts#L61)

#### [export-save.test.ts](tests/client/export-save.test.ts) (4 declarations)

- [strips the source doc extension and appends the target one](tests/client/export-save.test.ts#L5)
- [maps html to text/html and anything else to a generic binary type](tests/client/export-save.test.ts#L15)
- [round-trips utf8 text](tests/client/export-save.test.ts#L23)
- [round-trips base64 bytes](tests/client/export-save.test.ts#L29)

#### [head-metadata.test.ts](tests/client/head-metadata.test.ts) (2 declarations)

- [replaces shell tags and preserves repeated Open Graph order](tests/client/head-metadata.test.ts#L11)
- [clears old declarations for listing and error routes](tests/client/head-metadata.test.ts#L38)

#### [listing-layout.test.ts](tests/client/listing-layout.test.ts) (1 declarations)

- [shows delete confirmation for selected files in full-width mode](tests/client/listing-layout.test.ts#L35)

#### [mdx-block.test.ts](tests/client/mdx-block.test.ts) (8 declarations)

- [preserves a nested JSX component and its expressions without taking following Markdown](tests/client/mdx-block.test.ts#L23)
- [serializes inserted and edited source as raw MDX](tests/client/mdx-block.test.ts#L43)
- [keeps adjacent components distinct from each other and following text](tests/client/mdx-block.test.ts#L61)
- [preserves permitted leading indentation on a flow component](tests/client/mdx-block.test.ts#L71)
- [recognizes JSX even when later tolerant Markdown is not valid MDX](tests/client/mdx-block.test.ts#L79)
- [edits the component through its labeled source field](tests/client/mdx-block.test.ts#L88)
- [does not classify ordinary Markdown containing an angle bracket as a component](tests/client/mdx-block.test.ts#L109)
- [keeps the human text field focused while clearing and replacing component content](tests/client/mdx-block.test.ts#L114)

#### [mermaid-chart-detection.test.ts](tests/client/mermaid-chart-detection.test.ts) (7 declarations)

- [recognizes every chart keyword through indent, args, preamble, and body noise](tests/client/mermaid-chart-detection.test.ts#L71)
- [never matches a generated flowchart/other-diagram header](tests/client/mermaid-chart-detection.test.ts#L81)
- [a chart keyword appearing only in the body (never the header) stays null](tests/client/mermaid-chart-detection.test.ts#L90)
- [a keyword directly followed by more identifier characters is not recognised](tests/client/mermaid-chart-detection.test.ts#L101)
- [a keyword followed by whitespace is recognised regardless of what follows](tests/client/mermaid-chart-detection.test.ts#L109)
- [a recognised chart source never reads as a flowchart direction](tests/client/mermaid-chart-detection.test.ts#L123)
- [always names the keyword and <Chart>](tests/client/mermaid-chart-detection.test.ts#L133)

#### [mermaid-chart.test.ts](tests/client/mermaid-chart.test.ts) (10 declarations)

- [recognizes ${…} in a realistic diagram](tests/client/mermaid-chart.test.ts#L18)
- [recognizes ${…} indented](tests/client/mermaid-chart.test.ts#L22)
- [recognizes ${…} with a trailing comment on the header line](tests/client/mermaid-chart.test.ts#L26)
- [returns null for ${…}](tests/client/mermaid-chart.test.ts#L50)
- [returns null for ${…}](tests/client/mermaid-chart.test.ts#L60)
- [returns null when a chart keyword appears only in the body](tests/client/mermaid-chart.test.ts#L67)
- [skips a closed front-matter block](tests/client/mermaid-chart.test.ts#L73)
- [skips a multi-line %%{init}%% directive](tests/client/mermaid-chart.test.ts#L78)
- [returns null for an unclosed front-matter block](tests/client/mermaid-chart.test.ts#L85)
- [names ${…} and <Chart>](tests/client/mermaid-chart.test.ts#L93)

#### [mermaid-direction.test.ts](tests/client/mermaid-direction.test.ts) (8 declarations)

- [reads the direction off flowchart and graph headers](tests/client/mermaid-direction.test.ts#L5)
- [treats TD as TB and a missing direction as TB](tests/client/mermaid-direction.test.ts#L12)
- [looks past front matter, comments and directives](tests/client/mermaid-direction.test.ts#L17)
- [returns null for other diagram types and near-misses](tests/client/mermaid-direction.test.ts#L32)
- [rewrites only the direction token](tests/client/mermaid-direction.test.ts#L43)
- [adds a direction to a bare header](tests/client/mermaid-direction.test.ts#L53)
- [leaves the source alone when nothing would change](tests/client/mermaid-direction.test.ts#L58)
- [keeps front matter and directives byte-for-byte](tests/client/mermaid-direction.test.ts#L67)

#### [mermaid-flowchart-direction.test.ts](tests/client/mermaid-flowchart-direction.test.ts) (6 declarations)

- [is read back by readFlowchartDirection](tests/client/mermaid-flowchart-direction.test.ts#L57)
- [changes exactly one line, and only the direction on it](tests/client/mermaid-flowchart-direction.test.ts#L65)
- [is idempotent](tests/client/mermaid-flowchart-direction.test.ts#L83)
- [is a no-op when the flowchart already lays out that way](tests/client/mermaid-flowchart-direction.test.ts#L92)
- [never touches a source that is not a flowchart](tests/client/mermaid-flowchart-direction.test.ts#L102)
- [never throws and always preserves the line count](tests/client/mermaid-flowchart-direction.test.ts#L114)

#### [modal.test.ts](tests/client/modal.test.ts) (5 declarations)

- [blocks native cancellation and backdrop dismissal while pending, then uses the latest callback](tests/client/modal.test.ts#L37)
- [separates backdrop policy from Escape and ignores drags from inside](tests/client/modal.test.ts#L57)
- [keeps nested cancellation local and restores scrolling when the whole tree unmounts](tests/client/modal.test.ts#L73)
- [focuses the requested input and returns focus on unmount](tests/client/modal.test.ts#L98)
- [retains a %s modal and scroll lock until its exit animation finishes](tests/client/modal.test.ts#L113)

#### [permissions-readonly.test.ts](tests/client/permissions-readonly.test.ts) (3 declarations)

- [keeps restricted document sections readable without loading the editor](tests/client/permissions-readonly.test.ts#L40)
- [keeps restricted listing navigation and sort while removing selection and delete](tests/client/permissions-readonly.test.ts#L63)
- [retains editor and selection controls in local mode](tests/client/permissions-readonly.test.ts#L90)

#### [route-path.test.ts](tests/client/route-path.test.ts) (4 declarations)

- [decodes a percent-encoded pathname](tests/client/route-path.test.ts#L6)
- [leaves an already-decoded pathname alone](tests/client/route-path.test.ts#L11)
- [keeps a pathname with a stray percent sign rather than throwing](tests/client/route-path.test.ts#L15)
- [inverts encodeURI for any path made of unreserved and space characters](tests/client/route-path.test.ts#L19)

#### [standalone-settings.test.ts](tests/client/standalone-settings.test.ts) (1 declarations)

- [opens local settings from the standalone toolbar and applies autosaved layout controls](tests/client/standalone-settings.test.ts#L68)

#### [table-state.test.ts](tests/client/table-state.test.ts) (6 declarations)

- [removes deleted columns from sorting, filters, and units without reviving them when re-added](tests/client/table-state.test.ts#L13)
- [migrates legacy preferences by retaining only fields supported by each current type](tests/client/table-state.test.ts#L32)
- [discards bounds in incompatible units instead of silently changing their meaning](tests/client/table-state.test.ts#L56)
- [resets preferences when a known column changes type while retaining a valid sort key](tests/client/table-state.test.ts#L73)
- [preserves compatible invalid input so users can correct it](tests/client/table-state.test.ts#L92)
- [is idempotent and leaves the supplied state untouched](tests/client/table-state.test.ts#L112)

#### [toast-count-lifecycle.test.ts](tests/client/toast-count-lifecycle.test.ts) (1 declarations)

- [tracks the push streak since an id was last absent from live, keeping counts scoped to live ids](tests/client/toast-count-lifecycle.test.ts#L15)

#### [toast-count.test.ts](tests/client/toast-count.test.ts) (5 declarations)

- [increments a repeat push on a live id](tests/client/toast-count.test.ts#L5)
- [starts an unseen id at 1](tests/client/toast-count.test.ts#L12)
- [resets to 1 for an id that is counted but no longer live](tests/client/toast-count.test.ts#L19)
- [prunes ids absent from live](tests/client/toast-count.test.ts#L26)
- [keeps ids present in live](tests/client/toast-count.test.ts#L36)

### components

#### [controller-results.test.ts](tests/components/controller-results.test.ts) (6 declarations)

- [output always parses under its schema, and every filtered result is in the unfiltered one](tests/components/controller-results.test.ts#L44)
- [lists exactly the registry's components, in registry order, when unfiltered](tests/components/controller-results.test.ts#L63)
- [a component's own name always finds it](tests/components/controller-results.test.ts#L75)
- [every listed component resolves, parses under its schema, and round-trips its name](tests/components/controller-results.test.ts#L90)
- [a name no component has is always NOT_FOUND](tests/components/controller-results.test.ts#L108)
- [lookup is case-insensitive: any casing of a known name resolves to the same entry](tests/components/controller-results.test.ts#L121)

#### [controller.test.ts](tests/components/controller.test.ts) (9 declarations)

- [lists every component with its prop names when no query is given](tests/components/controller.test.ts#L11)
- [filters case-insensitively across name, description, whenToUse, and prop names](tests/components/controller.test.ts#L20)
- [returns an empty list rather than erroring when nothing matches](tests/components/controller.test.ts#L27)
- [returns the full registry entry, props schema included](tests/components/controller.test.ts#L35)
- [looks up case-insensitively](tests/components/controller.test.ts#L41)
- [carries `children` through for a component that takes children](tests/components/controller.test.ts#L45)
- [rejects an unknown name with NOT_FOUND and a did-you-mean hint](tests/components/controller.test.ts#L50)
- [rejects an unknown name with no near miss, without an empty hint](tests/components/controller.test.ts#L57)
- [rejects an empty name at the schema, before the service is reached](tests/components/controller.test.ts#L64)

#### [registry-search.test.ts](tests/components/registry-search.test.ts) (4 declarations)

- [returns at most 3 names](tests/components/registry-search.test.ts#L16)
- [only returns names that exist in the registry](tests/components/registry-search.test.ts#L24)
- [every prefix match precedes every includes-only match](tests/components/registry-search.test.ts#L35)
- [a name with one character dropped is still suggested (unless 3 better matches crowd it out)](tests/components/registry-search.test.ts#L51)

#### [service-search.test.ts](tests/components/service-search.test.ts) (4 declarations)

- [list(query) is a subset (by name) of list()](tests/components/service-search.test.ts#L18)
- [is case-insensitive and its hit is present in list()](tests/components/service-search.test.ts#L32)
- [returns undefined for a name that is not in the registry](tests/components/service-search.test.ts#L50)
- [returns at most 3 names, every one of which is a real registry name](tests/components/service-search.test.ts#L65)

#### [service.test.ts](tests/components/service.test.ts) (18 declarations)

- [returns every component when no query is given](tests/components/service.test.ts#L8)
- [matches a name case-insensitively](tests/components/service.test.ts#L12)
- [matches on the description](tests/components/service.test.ts#L16)
- [matches on whenToUse](tests/components/service.test.ts#L20)
- [matches on a prop name](tests/components/service.test.ts#L24)
- [returns nothing for a query that matches nothing](tests/components/service.test.ts#L28)
- [treats a whitespace-only query as no query](tests/components/service.test.ts#L32)
- [reduces props to their names, keeping the prose fields](tests/components/service.test.ts#L38)
- [gives a component with no props an empty prop list, not undefined](tests/components/service.test.ts#L49)
- [summarizes exactly the components list() returns, in the same order](tests/components/service.test.ts#L54)
- [finds a component by its exact name](tests/components/service.test.ts#L62)
- [finds a component whatever the casing](tests/components/service.test.ts#L66)
- [returns undefined for an unknown name](tests/components/service.test.ts#L70)
- [does not match on a substring — find is exact](tests/components/service.test.ts#L74)
- [suggests the component a typo was aiming at](tests/components/service.test.ts#L80)
- [suggests prefix matches first](tests/components/service.test.ts#L84)
- [returns at most three suggestions](tests/components/service.test.ts#L88)
- [returns nothing when the name resembles no component at all](tests/components/service.test.ts#L92)

### diagrams

#### [adapters.test.ts](tests/diagrams/adapters.test.ts) (4 declarations)

- [decodes image bytes rather than trusting MIME](tests/diagrams/adapters.test.ts#L18)
- [validates ER and flowchart syntax and rejects invalid syntax](tests/diagrams/adapters.test.ts#L26)
- [blocks active content without rejecting flowchart arrows](tests/diagrams/adapters.test.ts#L32)
- [rejects images whose normalized PNG exceeds the byte limit](tests/diagrams/adapters.test.ts#L37)

#### [agents.test.ts](tests/diagrams/agents.test.ts) (3 declarations)

- [uses Claude's noninteractive streaming image protocol and cleans temporary data](tests/diagrams/agents.test.ts#L8)
- [reports a rejected Claude token without exposing the raw response or switching agents](tests/diagrams/agents.test.ts#L45)
- [uses Codex structured output, no approvals, and stdin data](tests/diagrams/agents.test.ts#L64)

#### [controller-input-limits.test.ts](tests/diagrams/controller-input-limits.test.ts) (1 declarations)

- [rejects invalid revisions and never accepts oversized text](tests/diagrams/controller-input-limits.test.ts#L5)

#### [controller.test.ts](tests/diagrams/controller.test.ts) (3 declarations)

- [requires loopback even for preference reads](tests/diagrams/controller.test.ts#L8)
- [rejects cross-origin conversion and invalid input](tests/diagrams/controller.test.ts#L24)
- [returns typed drafts and persists disabled preference](tests/diagrams/controller.test.ts#L49)

#### [environment.test.ts](tests/diagrams/environment.test.ts) (1 declarations)

- [preserves gateway auth and Windows resolution without forwarding unrelated secrets](tests/diagrams/environment.test.ts#L4)

#### [models.test.ts](tests/diagrams/models.test.ts) (3 declarations)

- [initializes Codex before listing all model pages without starting a thread](tests/diagrams/models.test.ts#L10)
- [reads Claude initialization metadata without sending a user prompt](tests/diagrams/models.test.ts#L48)
- [rejects an incomplete catalog rather than inventing available models](tests/diagrams/models.test.ts#L73)

#### [service-revisions.test.ts](tests/diagrams/service-revisions.test.ts) (2 declarations)

- [an explicit provider is never changed](tests/diagrams/service-revisions.test.ts#L4)
- [cancelled revisions cannot resurrect](tests/diagrams/service-revisions.test.ts#L21)

#### [service.test.ts](tests/diagrams/service.test.ts) (14 declarations)

- [rejects remote and disabled calls without probing](tests/diagrams/service.test.ts#L4)
- [honors explicit preference without fallback](tests/diagrams/service.test.ts#L15)
- [repairs syntax once and rejects a second invalid result](tests/diagrams/service.test.ts#L31)
- [rejects late revisions cancelled before request arrival](tests/diagrams/service.test.ts#L41)
- [keeps conversion capacity available after many dialogs close while rejecting late requests](tests/diagrams/service.test.ts#L51)
- [still bounds unreleased sessions and frees capacity when one closes](tests/diagrams/service.test.ts#L75)
- [kills superseded work and serializes replacement](tests/diagrams/service.test.ts#L92)
- [enforces image ordering, ownership and bounds](tests/diagrams/service.test.ts#L120)
- [disabling aborts work without accepting the result](tests/diagrams/service.test.ts#L142)
- [detects only on explicit request, including while disabled](tests/diagrams/service.test.ts#L168)
- [passes the configured model through syntax repair without probing or switching](tests/diagrams/service.test.ts#L181)
- [bounds discovery concurrency and aborts discovery on shutdown](tests/diagrams/service.test.ts#L206)
- [gives queued conversions their execution budget after dequeuing](tests/diagrams/service.test.ts#L235)
- [admits the newest queued edit with explicit cancellation %s](tests/diagrams/service.test.ts#L264)

### docs

#### [controller-save.test.ts](tests/docs/controller-save.test.ts) (2 declarations)

- [save then read equals the spliceLines oracle, and the returned version is the new file's](tests/docs/controller-save.test.ts#L41)
- [a stale version never changes the file (invariance under rejected saves)](tests/docs/controller-save.test.ts#L80)

#### [controller.test.ts](tests/docs/controller.test.ts) (8 declarations)

- [returns the raw text and a version token for those exact bytes](tests/docs/controller.test.ts#L43)
- [rejects a path outside every root with NOT_FOUND](tests/docs/controller.test.ts#L50)
- [rejects a file over the editor size cap with PAYLOAD_TOO_LARGE](tests/docs/controller.test.ts#L56)
- [replaces exactly the requested line range and returns the new version](tests/docs/controller.test.ts#L79)
- [rejects a stale version with CONFLICT and leaves the file untouched](tests/docs/controller.test.ts#L95)
- [rejects a line range past the end of the file with CONFLICT](tests/docs/controller.test.ts#L109)
- [rejects markdown that would break the doc with UNPROCESSABLE_CONTENT, without writing](tests/docs/controller.test.ts#L123)
- [rejects a path outside every root with NOT_FOUND](tests/docs/controller.test.ts#L137)

#### [doc-cache-freshness.test.ts](tests/docs/doc-cache-freshness.test.ts) (5 declarations)

- [lines rejoin (by the file's own EOL) to reproduce the full content, for content well under 64 KiB](tests/docs/doc-cache-freshness.test.ts#L40)
- [truncates to exactly the first 64 KiB for a larger file](tests/docs/doc-cache-freshness.test.ts#L55)
- [the same (path, mtime) returns the cached document even if disk bytes change](tests/docs/doc-cache-freshness.test.ts#L68)
- [a new mtime returns the changed document](tests/docs/doc-cache-freshness.test.ts#L86)
- [a cache warmed on unrelated files returns the same value as a fresh cache for the target file](tests/docs/doc-cache-freshness.test.ts#L106)

#### [edit-line-ranges.test.ts](tests/docs/edit-line-ranges.test.ts) (6 declarations)

- [splicing \[s, e\] with exactly its own lines is the identity](tests/docs/edit-line-ranges.test.ts#L89)
- [lines before start and after end are unchanged; EOL and trailing-newline state are preserved](tests/docs/edit-line-ranges.test.ts#L104)
- [output line count = input - (end - start + 1) + replacement line count](tests/docs/edit-line-ranges.test.ts#L130)
- [splicing the later range first equals splicing the earlier one first, with the later range shifted](tests/docs/edit-line-ranges.test.ts#L178)
- [an invalid \[start, end\] never throws and always reports ok: false](tests/docs/edit-line-ranges.test.ts#L206)
- [examples: below-range start, above-range end, inverted range, and a non-integer all fail cleanly](tests/docs/edit-line-ranges.test.ts#L231)

#### [frontmatter.test.ts](tests/docs/frontmatter.test.ts) (2 declarations)

- [skips only a complete leading YAML block: %j](tests/docs/frontmatter.test.ts#L5)
- [preserves body rules, examples, and unclosed blocks: %j](tests/docs/frontmatter.test.ts#L15)

#### [metadata.test.ts](tests/docs/metadata.test.ts) (11 declarations)

- [normalizes ordered and repeated Open Graph values for .%s](tests/docs/metadata.test.ts#L6)
- [uses the actual leading YAML boundary](tests/docs/metadata.test.ts#L45)
- [falls back with original YAML location for invalid metadata: %s](tests/docs/metadata.test.ts#L54)
- [bounds metadata parsing even when the document body is much larger](tests/docs/metadata.test.ts#L73)
- [accepts a closing fence at EOF with BOM and CRLF](tests/docs/metadata.test.ts#L79)
- [parses CR and mixed-newline frontmatter: %j](tests/docs/metadata.test.ts#L86)
- [finds a CR closing fence in a truncated metadata prefix](tests/docs/metadata.test.ts#L98)
- [accepts empty frontmatter before a large body](tests/docs/metadata.test.ts#L106)
- [accepts YAML at the 64 KiB boundary and warns above it](tests/docs/metadata.test.ts#L113)
- [stops scanning an oversized opening before the body](tests/docs/metadata.test.ts#L121)
- [preserves valid scalar titles without creating Open Graph defaults](tests/docs/metadata.test.ts#L142)

#### [service-save.test.ts](tests/docs/service-save.test.ts) (4 declarations)

- [readSource after saveSection matches the spliceLines oracle, for either EOL style and trailing-newline state](tests/docs/service-save.test.ts#L55)
- [a stale version, an out-of-range line range, and invalid markdown all leave the file byte-identical, with no leftover .*.mdxserve-tmp file](tests/docs/service-save.test.ts#L104)
- [two concurrent saves on one instance with the same original version: exactly one ok, the other stale](tests/docs/service-save.test.ts#L169)
- [keeps metadata and YAML boundaries independent of the document body and newline style](tests/docs/service-save.test.ts#L223)

#### [service.test.ts](tests/docs/service.test.ts) (27 declarations)

- [parses static metadata without evaluating document code](tests/docs/service.test.ts#L39)
- [reports invalid and truncated metadata without exposing partial values](tests/docs/service.test.ts#L48)
- [locates only leading YAML and preserves its original value](tests/docs/service.test.ts#L57)
- [returns the raw on-disk text with a version token for those bytes](tests/docs/service.test.ts#L68)
- [reports a path outside every root as not-found](tests/docs/service.test.ts#L76)
- [reports a missing file as not-found](tests/docs/service.test.ts#L82)
- [refuses a file over the editor size cap, reporting its size](tests/docs/service.test.ts#L86)
- [reports a file removed after path resolution as not-found](tests/docs/service.test.ts#L98)
- [closes the handle when reading fails with %s](tests/docs/service.test.ts#L114)
- [reads a bounded prefix of a sparse document with %s](tests/docs/service.test.ts#L143)
- [reads metadata above the editor limit while readSource keeps its cap](tests/docs/service.test.ts#L183)
- [warns when multibyte YAML exceeds the byte limit](tests/docs/service.test.ts#L194)
- [applies root containment and public path rules](tests/docs/service.test.ts#L204)
- [preserves frontmatter bytes while saving a .%s body section](tests/docs/service.test.ts#L219)
- [saves an inserted Mermaid block in %s with the normal version guard](tests/docs/service.test.ts#L240)
- [replaces exactly the requested line range and returns the new version](tests/docs/service.test.ts#L268)
- [returns a version the next save can immediately use](tests/docs/service.test.ts#L281)
- [rejects a version that no longer matches the file, handing back the current one](tests/docs/service.test.ts#L303)
- [catches a change an mtime check would miss, because it compares bytes](tests/docs/service.test.ts#L316)
- [accepts a save when the file was edited back to the bytes it was read at](tests/docs/service.test.ts#L333)
- [rejects a line range past the end of the file without writing](tests/docs/service.test.ts#L346)
- [rejects markdown that would break the doc, reporting the diagnostics, without writing](tests/docs/service.test.ts#L358)
- [rejects a section save that introduces a mermaid pie fence, without writing](tests/docs/service.test.ts#L372)
- [reports a path outside every root as not-found](tests/docs/service.test.ts#L386)
- [leaves no staging file behind, on success or on rejection](tests/docs/service.test.ts#L400)
- [writes through a symlink to its target, leaving the link a link](tests/docs/service.test.ts#L419)
- [preserves the file's mode across the atomic replace](tests/docs/service.test.ts#L434)

### export

#### [controller-access-and-modes.test.ts](tests/export/controller-access-and-modes.test.ts) (3 declarations)

- [a non-loopback caller never resolves, for arbitrary path strings](tests/export/controller-access-and-modes.test.ts#L51)
- [against fenced.md, the call resolves and result.mermaid equals the requested mode](tests/export/controller-access-and-modes.test.ts#L69)
- [against plain.md, result.mermaid is always none regardless of the requested mode](tests/export/controller-access-and-modes.test.ts#L90)

#### [controller.test.ts](tests/export/controller.test.ts) (8 declarations)

- [returns a shape matching exportDocResultSchema, applying defaults when format/mermaid are omitted](tests/export/controller.test.ts#L60)
- [rejects a non-loopback caller with FORBIDDEN](tests/export/controller.test.ts#L70)
- [rejects a cross-origin mutation with FORBIDDEN](tests/export/controller.test.ts#L79)
- [rejects every path with NOT_FOUND when no roots are mounted, without calling the bundle port](tests/export/controller.test.ts#L88)
- [rejects a path outside every mounted root with NOT_FOUND](tests/export/controller.test.ts#L98)
- [rejects a non-.md/.mdx file with BAD_REQUEST](tests/export/controller.test.ts#L107)
- [rejects an invalid mermaid mode with BAD_REQUEST (zod) and never calls the bundle port](tests/export/controller.test.ts#L116)
- [maps a rejecting bundle port to INTERNAL_SERVER_ERROR](tests/export/controller.test.ts#L128)

#### [service-output.test.ts](tests/export/service-output.test.ts) (6 declarations)

- [result.mermaid follows the fence/requested-mode rule and the port receives the same mode](tests/export/service-output.test.ts#L39)
- [build never changes the fixture directory's file list or any file's bytes](tests/export/service-output.test.ts#L83)
- [fileName never contains a path separator, always ends in .html, and its stem matches the source basename](tests/export/service-output.test.ts#L125)
- [export() then reading outFile equals build().contents exactly, and bytes equals the on-disk size](tests/export/service-output.test.ts#L171)
- [a path escaping rootDirs (via .. or an absolute path under a different tmp dir) is not-found and never invokes the port](tests/export/service-output.test.ts#L228)
- [build never throws, and its kind is always one of the five declared members](tests/export/service-output.test.ts#L263)

#### [service.test.ts](tests/export/service.test.ts) (16 declarations)

- [embeds frontmatter metadata in exported .%s initial HTML](tests/export/service.test.ts#L70)
- [builds an ok result from the fake bundle port](tests/export/service.test.ts#L93)
- [build leaves the directory listing byte-identical](tests/export/service.test.ts#L108)
- [export writes outFile with bytes equal to build().contents](tests/export/service.test.ts#L120)
- [returns not-found for a missing file](tests/export/service.test.ts#L145)
- [returns not-a-doc for a non-markdown extension](tests/export/service.test.ts#L152)
- [returns unsupported-format for an unknown format](tests/export/service.test.ts#L159)
- [returns bundle-failed with the port's error message when the port rejects](tests/export/service.test.ts#L169)
- [a doc in a different root than rootDirs is not-found and never calls the bundle port](tests/export/service.test.ts#L178)
- [an escaping symlink is not-found](tests/export/service.test.ts#L186)
- [no rootDirs at all accepts an absolute path (CLI parity)](tests/export/service.test.ts#L196)
- [an empty rootDirs list (no folders served) resolves nothing and never calls the bundle port](tests/export/service.test.ts#L203)
- [forces mermaid to none for a doc with no fence, even when bundle is requested](tests/export/service.test.ts#L211)
- [forces mermaid to none for a pie-only doc, even when bundle is requested](tests/export/service.test.ts#L225)
- [still bundles mermaid for a doc mixing a chart fence with a real diagram](tests/export/service.test.ts#L239)
- [passes the requested mermaid mode through for a doc with a fence, defaulting to cdn](tests/export/service.test.ts#L253)

### http

#### [banner.test.ts](tests/http/banner.test.ts) (1 declarations)

- [advertises reachable local, API and document URLs for %s](tests/http/banner.test.ts#L6)

#### [doc-change-roots.test.ts](tests/http/doc-change-roots.test.ts) (2 declarations)

- [every servable doc under a root round-trips to root + rel](tests/http/doc-change-roots.test.ts#L12)
- [never attributes a file to a root that is not one of its ancestors](tests/http/doc-change-roots.test.ts#L28)

#### [doc-change.test.ts](tests/http/doc-change.test.ts) (6 declarations)

- [names a doc by its root-relative path](tests/http/doc-change.test.ts#L10)
- [matches the root the file lives in](tests/http/doc-change.test.ts#L18)
- [ignores files outside every root](tests/http/doc-change.test.ts#L22)
- [ignores non-doc files](tests/http/doc-change.test.ts#L27)
- [ignores docs under a dotdir or node_modules](tests/http/doc-change.test.ts#L32)
- [collapses .. segments before matching](tests/http/doc-change.test.ts#L38)

#### [host.test.ts](tests/http/host.test.ts) (6 declarations)

- [strips a port, unwraps IPv6 brackets, and lower-cases](tests/http/host.test.ts#L6)
- [accepts loopback names with or without a port](tests/http/host.test.ts#L18)
- [accepts the exact address the connection arrived on (the stdio bridge on --host <ip>)](tests/http/host.test.ts#L24)
- [rejects a rebinding domain, a different address, and a missing header](tests/http/host.test.ts#L30)
- [a DNS name is never trusted, whatever port or local address it comes with](tests/http/host.test.ts#L37)
- [the socket's own IPv4 address is trusted with any port](tests/http/host.test.ts#L54)

#### [metadata-round-trip.test.ts](tests/http/metadata-round-trip.test.ts) (1 declarations)

- [round-trips text and ordered repeated properties without creating elements](tests/http/metadata-round-trip.test.ts#L12)

#### [metadata.test.ts](tests/http/metadata.test.ts) (3 declarations)

- [escapes declarations, preserves order, and emits one title](tests/http/metadata.test.ts#L12)
- [serves metadata from a document above the editor source limit](tests/http/metadata.test.ts#L40)
- [serves metadata in restricted initial HTML without executing .%s imports](tests/http/metadata.test.ts#L63)

#### [server.test.ts](tests/http/server.test.ts) (26 declarations)

- [getDocTree returns a 200 envelope with roots](tests/http/server.test.ts#L43)
- [no longer serves /__mdxserve/api/tree as a 200 JSON response](tests/http/server.test.ts#L52)
- [405s a GET on a mutation (moveDocsToTrash)](tests/http/server.test.ts#L60)
- [415s a text/plain content type](tests/http/server.test.ts#L68)
- [415s a smuggled application/json inside a text/plain parameter](tests/http/server.test.ts#L78)
- [413s an oversized moveDocsToTrash body](tests/http/server.test.ts#L88)
- [400s an oversized validateDoc path (over the 4096-char input bound)](tests/http/server.test.ts#L100)
- [validateDoc.mutate runs the configured render stub and returns a result](tests/http/server.test.ts#L116)
- [validateDoc.mutate rejects with a NOT_FOUND TRPCClientError for a path outside every root](tests/http/server.test.ts#L131)
- [403s a mutation whose Origin does not match the Host it arrived on](tests/http/server.test.ts#L158)
- [accepts a mutation whose Origin matches the Host (what a browser sends same-origin)](tests/http/server.test.ts#L172)
- [leaves queries reachable cross-origin (nothing readable without CORS headers anyway)](tests/http/server.test.ts#L179)
- [GET / is a 200 home page with data-root-count="0" when nothing is mounted](tests/http/server.test.ts#L198)
- [GET / is a 200 home page for two mounted roots](tests/http/server.test.ts#L207)
- [GET / redirects (302) into the single mounted root](tests/http/server.test.ts#L223)
- [404s a doc path when nothing is mounted](tests/http/server.test.ts#L230)
- [a root added to the shared RootsService after startup is visible to getDocTree](tests/http/server.test.ts#L239)
- [advertises immutable-site mode only for MDXSERVE_IMMUTABLE_SITE=%s](tests/http/server.test.ts#L256)
- [renderShell(route) defaults to data-same-machine="0"](tests/http/server.test.ts#L272)
- [a loopback request for a doc URL gets a shell with data-same-machine="1"](tests/http/server.test.ts#L277)
- [addRoots is FORBIDDEN when a loopback request carries a foreign Host](tests/http/server.test.ts#L323)
- [rejects encoded separators in %s before routing internal files to Vite](tests/http/server.test.ts#L342)
- [serves the reader but denies same-origin writes and local-only reads on a loopback connection](tests/http/server.test.ts#L357)
- [blocks hidden files and links out of the root through both file routes](tests/http/server.test.ts#L396)
- [omits private symlink targets from source, listings, tree, and search](tests/http/server.test.ts#L437)
- [keeps visible doc and directory aliases to hidden targets in full mode only](tests/http/server.test.ts#L484)

#### [start.test.ts](tests/http/start.test.ts) (9 declarations)

- [reports already-running without port/host when no registry row exists yet](tests/http/start.test.ts#L30)
- [reports the registered port/host once the row exists](tests/http/start.test.ts#L46)
- [rejects invalid startup config and releases the server lock](tests/http/start.test.ts#L66)
- [rejects explicit full permissions on %s before changing saved roots or taking the lock](tests/http/start.test.ts#L79)
- [allows explicit full permissions on the network only with the dangerous opt-in](tests/http/start.test.ts#L95)
- [defaults network binding to restricted and requires one explicit root before taking the lock](tests/http/start.test.ts#L112)
- [does not promote a network bind to full permissions with the dangerous flag alone](tests/http/start.test.ts#L128)
- [rejects an invalid permissions mode before taking the lock](tests/http/start.test.ts#L141)
- [refuses to reuse an existing server when restricted permissions are requested](tests/http/start.test.ts#L160)

### infra

#### [cache.test.ts](tests/infra/cache.test.ts) (5 declarations)

- [defaults to ~/.cache/mdxserve](tests/infra/cache.test.ts#L29)
- [honours XDG_CACHE_HOME](tests/infra/cache.test.ts#L35)
- [MDXSERVE_CACHE_HOME wins over XDG_CACHE_HOME](tests/infra/cache.test.ts#L41)
- [lives directly under the cache home](tests/infra/cache.test.ts#L49)
- [removes the whole cache home and reports whether anything was there](tests/infra/cache.test.ts#L57)

#### [pkg.test.ts](tests/infra/pkg.test.ts) (5 declarations)

- [returns absolute node_modules dirs, led by the package's own](tests/infra/pkg.test.ts#L19)
- [includes the hosting node_modules when the package sits inside one](tests/infra/pkg.test.ts#L34)
- [returns only the package's own node_modules otherwise](tests/infra/pkg.test.ts#L43)
- [matches the version in package.json](tests/infra/pkg.test.ts#L53)
- [tells both installed and source-checkout users what to do](tests/infra/pkg.test.ts#L62)

#### [process-runner.test.ts](tests/infra/process-runner.test.ts) (4 declarations)

- [passes user input on stdin without interpreting it as shell](tests/infra/process-runner.test.ts#L4)
- [terminates a cancelled process](tests/infra/process-runner.test.ts#L14)
- [enforces time and output bounds](tests/infra/process-runner.test.ts#L24)
- [keeps stdin open for a protocol exchange and stops after the response](tests/infra/process-runner.test.ts#L41)

### listing

#### [controller-paths.test.ts](tests/listing/controller-paths.test.ts) (4 declarations)

- [readListing and readTree parse under their output schemas, idempotently](tests/listing/controller-paths.test.ts#L125)
- [is a fixpoint, and p, p/, p/./, p/x/.. give deep-equal output](tests/listing/controller-paths.test.ts#L162)
- [refuses every directory under a node_modules, for each path spelling, exactly as getDocTree does](tests/listing/controller-paths.test.ts#L196)
- [per directory, the doc names from readListing match the non-dir node names from readTree](tests/listing/controller-paths.test.ts#L230)

#### [controller.test.ts](tests/listing/controller.test.ts) (6 declarations)

- [lists a directory's entries](tests/listing/controller.test.ts#L56)
- [throws NOT_FOUND for a path outside every root](tests/listing/controller.test.ts#L67)
- [throws NOT_FOUND for a file path](tests/listing/controller.test.ts#L74)
- [with no path, returns one entry per rootInfo](tests/listing/controller.test.ts#L83)
- [narrows to the given directory](tests/listing/controller.test.ts#L96)
- [maxDepth truncates deeper nodes](tests/listing/controller.test.ts#L103)

#### [service-tree.test.ts](tests/listing/service-tree.test.ts) (3 declarations)

- [docTree({maxDepth: n}) equals docTree({maxDepth: n+1}) with nodes deeper than n pruned](tests/listing/service-tree.test.ts#L125)
- [every level is dirs-before-files in case-insensitive name order, and no non-servable name appears](tests/listing/service-tree.test.ts#L152)
- [dirAbs is set iff a path was given](tests/listing/service-tree.test.ts#L177)

#### [service.test.ts](tests/listing/service.test.ts) (6 declarations)

- [returns ok with the directory's entries](tests/listing/service.test.ts#L39)
- [returns not-found for a path outside every root](tests/listing/service.test.ts#L48)
- [returns not-found for a file path](tests/listing/service.test.ts#L53)
- [with no path, returns one entry per rootInfo](tests/listing/service.test.ts#L60)
- [narrows to the given directory and sets dirAbs](tests/listing/service.test.ts#L73)
- [returns not-found for a path outside every root](tests/listing/service.test.ts#L82)

### preferences

#### [service-choices.test.ts](tests/preferences/service-choices.test.ts) (1 declarations)

- [round trips all choices without changing roots](tests/preferences/service-choices.test.ts#L7)

#### [service.test.ts](tests/preferences/service.test.ts) (6 declarations)

- [defaults to unconfigured and disabled](tests/preferences/service.test.ts#L17)
- [preserves roots and unknown fields in both directions](tests/preferences/service.test.ts#L25)
- [refuses to overwrite a corrupt config](tests/preferences/service.test.ts#L36)
- [preserves model overrides when changing agents](tests/preferences/service.test.ts#L43)
- [requires explicit selection for legacy auto and discards the old toggle on save](tests/preferences/service.test.ts#L49)
- [rejects empty or malformed model names without changing preferences](tests/preferences/service.test.ts#L59)

### rendering

#### [app-css.test.ts](tests/rendering/app-css.test.ts) (1 declarations)

- [includes the styles and source paths needed by served docs](tests/rendering/app-css.test.ts#L12)

#### [frontmatter.test.ts](tests/rendering/frontmatter.test.ts) (4 declarations)

- [renders only the body, including when metadata contains JSX and braces](tests/rendering/frontmatter.test.ts#L44)
- [preserves original editable body line numbers with CRLF input](tests/rendering/frontmatter.test.ts#L51)
- [ignores metadata during validation but still diagnoses the body at its original line](tests/rendering/frontmatter.test.ts#L56)
- [keeps thematic breaks and frontmatter examples in the body visible](tests/rendering/frontmatter.test.ts#L75)

#### [fs-allow.test.ts](tests/rendering/fs-allow.test.ts) (1 declarations)

- [denies a file outside fs.allow, then serves it once its directory is allowed](tests/rendering/fs-allow.test.ts#L51)

#### [immutable-site.test.ts](tests/rendering/immutable-site.test.ts) (2 declarations)

- [serves the app and every site document with one optimized dependency version](tests/rendering/immutable-site.test.ts#L48)
- [serves CSS helpers without starting a browser WebSocket](tests/rendering/immutable-site.test.ts#L75)

#### [inline-images.test.ts](tests/rendering/inline-images.test.ts) (3 declarations)

- [inlines a hast <img>, a JSX <img>, and a <Screenshot> src alike](tests/rendering/inline-images.test.ts#L42)
- [leaves a src on any other component alone](tests/rendering/inline-images.test.ts#L57)
- [keeps an absolute or remote Screenshot src as is, and warns on a missing file](tests/rendering/inline-images.test.ts#L63)

#### [lenient-md-syntax.test.ts](tests/rendering/lenient-md-syntax.test.ts) (17 declarations)

- [is idempotent](tests/rendering/lenient-md-syntax.test.ts#L7)
- [preserves line count](tests/rendering/lenient-md-syntax.test.ts#L17)
- [preserves recognized frontmatter exactly while escaping body prose](tests/rendering/lenient-md-syntax.test.ts#L25)
- [preserves a mixed-newline header and escapes CR-delimited body lines](tests/rendering/lenient-md-syntax.test.ts#L42)
- [escapes an unclosed frontmatter-like block as ordinary body text](tests/rendering/lenient-md-syntax.test.ts#L47)
- [preserves nested and multiline MDX expressions while escaping neighboring prose](tests/rendering/lenient-md-syntax.test.ts#L51)
- [preserves comparisons after regex braces inside an MDX expression](tests/rendering/lenient-md-syntax.test.ts#L63)
- [preserves regex literals after a control-flow condition](tests/rendering/lenient-md-syntax.test.ts#L68)
- [preserves quoted JSX attribute values](tests/rendering/lenient-md-syntax.test.ts#L73)
- [preserves division after a postfix operator in an expression](tests/rendering/lenient-md-syntax.test.ts#L78)
- [escapes prose after an unmatched backtick](tests/rendering/lenient-md-syntax.test.ts#L83)
- [does not use backticks inside a fence as an inline-code closer](tests/rendering/lenient-md-syntax.test.ts#L89)
- [does not use escaped backticks as inline-code delimiters](tests/rendering/lenient-md-syntax.test.ts#L95)
- [keeps comparisons in ESM declarations and escapes following prose](tests/rendering/lenient-md-syntax.test.ts#L101)
- [does not close a fence on a line with trailing content](tests/rendering/lenient-md-syntax.test.ts#L106)
- [leaves text inside fenced code blocks unchanged](tests/rendering/lenient-md-syntax.test.ts#L117)
- [leaves text inside inline code spans unchanged](tests/rendering/lenient-md-syntax.test.ts#L133)

#### [metadata-compiler.test.ts](tests/rendering/metadata-compiler.test.ts) (6 declarations)

- [uses the supplied metadata service for the compiled export](tests/rendering/metadata-compiler.test.ts#L23)
- [exports normalized ordered metadata without executable source](tests/rendering/metadata-compiler.test.ts#L37)
- [reports the reserved metadata name for %s](tests/rendering/metadata-compiler.test.ts#L53)
- [allows the metadata name in nested scopes and object properties](tests/rendering/metadata-compiler.test.ts#L81)
- [exports empty metadata when frontmatter is absent](tests/rendering/metadata-compiler.test.ts#L93)
- [exports metadata from CR-only frontmatter](tests/rendering/metadata-compiler.test.ts#L101)

#### [remark-sections-structure.test.ts](tests/rendering/remark-sections-structure.test.ts) (12 declarations)

- [produces a saveable range for an EOF fence with %j ending](tests/rendering/remark-sections-structure.test.ts#L39)
- [flattening every MdSection's children back in place reproduces the original children](tests/rendering/remark-sections-structure.test.ts#L148)
- [only direct flow JSX may enter a section; other unsupported nodes stay outside](tests/rendering/remark-sections-structure.test.ts#L162)
- [adjacent sections are separated by a heading, standalone Mermaid block, or raw JSX](tests/rendering/remark-sections-structure.test.ts#L180)
- [ranges are ascending/non-overlapping and index attributes count 0..n-1 in order](tests/rendering/remark-sections-structure.test.ts#L210)
- [slicing the source at \[startLine, endLine\] and re-parsing reproduces the section's text](tests/rendering/remark-sections-structure.test.ts#L230)
- [a doc starting with `---` on line 1 has no section starting at line 1](tests/rendering/remark-sections-structure.test.ts#L251)
- [a doc that opens with an unambiguous horizontal rule stays editable from line 1](tests/rendering/remark-sections-structure.test.ts#L259)
- [an unclosed leading `---` is not front matter: the doc stays editable](tests/rendering/remark-sections-structure.test.ts#L266)
- [no section covers any front-matter line, whatever the block's shape](tests/rendering/remark-sections-structure.test.ts#L273)
- [isolates a JSX block from surrounding Markdown for safe diagram editing](tests/rendering/remark-sections-structure.test.ts#L303)
- [nested component expressions remain inside the range without covering following ESM](tests/rendering/remark-sections-structure.test.ts#L316)

#### [render-concurrency.test.ts](tests/rendering/render-concurrency.test.ts) (1 declarations)

- [N concurrent renders on one RenderService return N outcomes matched to their own docs](tests/rendering/render-concurrency.test.ts#L60)

#### [render.test.ts](tests/rendering/render.test.ts) (10 declarations)

- [preserves Markdown frontmatter metadata through the Vite transform](tests/rendering/render.test.ts#L63)
- [reports a render-time ReferenceError with a matching line number](tests/rendering/render.test.ts#L75)
- [recovers a render queued behind a timed-out one](tests/rendering/render.test.ts#L87)
- [re-renders a doc from disk after it changes](tests/rendering/render.test.ts#L105)
- [renders ok once the identifier is bound](tests/rendering/render.test.ts#L122)
- [renders every builtin (including every Chart form), a fence, a GFM table, and a task list](tests/rendering/render.test.ts#L131)
- [times out on a document that hangs asynchronously](tests/rendering/render.test.ts#L186)
- [times out on a document with a synchronous infinite loop, without hanging the process](tests/rendering/render.test.ts#L207)
- [respawns a working worker after a prior render timed out](tests/rendering/render.test.ts#L221)
- [handles two concurrent renders on different documents](tests/rendering/render.test.ts#L234)

### roots

#### [config.test.ts](tests/roots/config.test.ts) (10 declarations)

- [persists startup additions, API additions and removals across fresh instances](tests/roots/config.test.ts#L29)
- [preserves user spelling on startup and unrelated settings on mutations](tests/roots/config.test.ts#L42)
- [reloads edits, atomic replacements, empty roots and recreation after deletion](tests/roots/config.test.ts#L56)
- [keeps the last good roots and refuses to overwrite invalid config: %s](tests/roots/config.test.ts#L72)
- [refuses removals from rejected %s config without changing the file or live roots](tests/roots/config.test.ts#L91)
- [reads pending user edits before mutations and removes deleted directories](tests/roots/config.test.ts#L120)
- [does not overwrite an intervening user edit](tests/roots/config.test.ts#L131)
- [failed writes leave mounted roots unchanged](tests/roots/config.test.ts#L140)
- [serializes concurrent additions without losing either root](tests/roots/config.test.ts#L149)
- [arbitrary add/remove sequences always survive restart](tests/roots/config.test.ts#L157)

#### [controller-paths.test.ts](tests/roots/controller-paths.test.ts) (2 declarations)

- [a random absolute path under a directory that doesn't exist is always NOT_FOUND](tests/roots/controller-paths.test.ts#L46)
- [a relative dirs entry is rejected by the schema before RootsService sees it](tests/roots/controller-paths.test.ts#L66)

#### [controller.test.ts](tests/roots/controller.test.ts) (12 declarations)

- [addRoots is FORBIDDEN for a non-loopback caller](tests/roots/controller.test.ts#L54)
- [removeRoots is FORBIDDEN for a non-loopback caller](tests/roots/controller.test.ts#L63)
- [ok: mounts the directory and returns it in added and roots](tests/roots/controller.test.ts#L74)
- [not-found: NOT_FOUND](tests/roots/controller.test.ts#L81)
- [not-a-directory: BAD_REQUEST](tests/roots/controller.test.ts#L89)
- [refused (/): FORBIDDEN](tests/roots/controller.test.ts#L102)
- [nested: CONFLICT](tests/roots/controller.test.ts#L109)
- [a relative path is rejected by the schema with BAD_REQUEST](tests/roots/controller.test.ts#L122)
- [ok: unmounts the directory](tests/roots/controller.test.ts#L132)
- [not-mounted: NOT_FOUND](tests/roots/controller.test.ts#L139)
- [a relative path is rejected by the schema with BAD_REQUEST](tests/roots/controller.test.ts#L146)
- [reflects a prior addRoots against the same RootsService](tests/roots/controller.test.ts#L156)

#### [paths-containment.test.ts](tests/roots/paths-containment.test.ts) (6 declarations)

- [an ok result's realpath is always inside the root's realpath](tests/roots/paths-containment.test.ts#L76)
- [an ok result's realpath is always inside the root's realpath](tests/roots/paths-containment.test.ts#L95)
- [resolveRoot(resolveRoot(p).abs) agrees with resolveRoot(p)](tests/roots/paths-containment.test.ts#L114)
- [~/<rel> lands inside home at exactly <rel>](tests/roots/paths-containment.test.ts#L149)
- [is the identity on anything that does not start with ~ or ~/](tests/roots/paths-containment.test.ts#L159)
- [is idempotent once the result no longer starts with ~](tests/roots/paths-containment.test.ts#L173)

#### [paths.test.ts](tests/roots/paths.test.ts) (18 declarations)

- [resolves an absolute path with zero served roots](tests/roots/paths.test.ts#L53)
- [still rejects a non-.md/.mdx file with zero served roots](tests/roots/paths.test.ts#L59)
- [still rejects a path whose parent directory doesn't exist, with zero served roots](tests/roots/paths.test.ts#L66)
- [rejects a symlinked directory inside the root that points outside it](tests/roots/paths.test.ts#L73)
- [still accepts a plain file inside the root](tests/roots/paths.test.ts#L78)
- [keeps a visible %s alias to a hidden target in full mode but rejects it in restricted mode](tests/roots/paths.test.ts#L86)
- [accepts a symlinked doc whose target stays inside the root](tests/roots/paths.test.ts#L95)
- [rejects a symlinked doc whose target is outside the root](tests/roots/paths.test.ts#L100)
- [accepts a symlinked doc with no roots (nothing to be contained in)](tests/roots/paths.test.ts#L105)
- [resolveDocPath accepts a doc reached via the alias and reports the real root](tests/roots/paths.test.ts#L112)
- [resolveDirPath accepts a directory reached via the alias](tests/roots/paths.test.ts#L117)
- [keeps a visible directory alias to a hidden target in full mode but rejects it in restricted mode](tests/roots/paths.test.ts#L124)
- [accepts a real directory inside a root](tests/roots/paths.test.ts#L130)
- [rejects a symlinked directory that points outside the root](tests/roots/paths.test.ts#L135)
- [rejects files, missing paths, and paths outside every root](tests/roots/paths.test.ts#L140)
- [resolves literal, extensionless, and directory-index specifiers like Vite](tests/roots/paths.test.ts#L152)
- [expands a bare ~ and a leading ~/](tests/roots/paths.test.ts#L165)
- [leaves ~user, a mid-path ~, and ordinary paths alone](tests/roots/paths.test.ts#L171)

#### [service-admission.test.ts](tests/roots/service-admission.test.ts) (7 declarations)

- [an ok admission never contains a duplicate or a root nested inside another](tests/roots/service-admission.test.ts#L39)
- [the verdict does not depend on the order the roots were named in](tests/roots/service-admission.test.ts#L62)
- [repeating a root any number of times admits exactly the same set as naming it once](tests/roots/service-admission.test.ts#L83)
- [every admitted root has a rootInfo, and the display names are unique](tests/roots/service-admission.test.ts#L106)
- [after every add/remove step, list() matches a Set<string> reference model and stays invariant-clean](tests/roots/service-admission.test.ts#L173)
- [running the same batch of commands concurrently still leaves list() invariant-clean](tests/roots/service-admission.test.ts#L206)
- [the listener fires exactly once per ok result with a non-empty delta](tests/roots/service-admission.test.ts#L238)

#### [service.test.ts](tests/roots/service.test.ts) (30 declarations)

- [expands a leading ~/ against the home it was given](tests/roots/service.test.ts#L25)
- [does not treat ~user as a home shortcut](tests/roots/service.test.ts#L34)
- [admits a directory and names it by its basename](tests/roots/service.test.ts#L40)
- [resolves a relative input against the cwd it was constructed with](tests/roots/service.test.ts#L49)
- [admits an empty set of roots for an empty input list](tests/roots/service.test.ts#L58)
- [reports a missing directory as not-found, naming the absolute path](tests/roots/service.test.ts#L64)
- [reports a file as not-a-directory](tests/roots/service.test.ts#L71)
- [refuses to serve /](tests/roots/service.test.ts#L79)
- [refuses a root nested inside another, naming both](tests/roots/service.test.ts#L84)
- [refuses nesting whichever order the roots are named in](tests/roots/service.test.ts#L95)
- [drops a symlinked alias of an already-named root instead of serving it twice](tests/roots/service.test.ts#L103)
- [disambiguates two roots whose basenames collide](tests/roots/service.test.ts#L114)
- [starts with the seeded mounted list](tests/roots/service.test.ts#L132)
- [add() mounts a new directory](tests/roots/service.test.ts#L138)
- [re-adding an already-mounted root is ok with an empty added list and no listener call](tests/roots/service.test.ts#L150)
- [refuses adding a directory nested inside an already-mounted root](tests/roots/service.test.ts#L163)
- [refuses adding a parent of an already-mounted root](tests/roots/service.test.ts#L172)
- [refuses adding /](tests/roots/service.test.ts#L181)
- [reports a missing directory as not-found](tests/roots/service.test.ts#L187)
- [reports a file as not-a-directory](tests/roots/service.test.ts#L195)
- [leaves the mounted set unchanged after a failed add](tests/roots/service.test.ts#L204)
- [remove() unmounts a mounted root](tests/roots/service.test.ts#L212)
- [remove() reports an unmounted directory as not-mounted](tests/roots/service.test.ts#L220)
- [remove() accepts a symlinked alias of a mounted root](tests/roots/service.test.ts#L227)
- [remove() still works after the mounted directory itself was deleted](tests/roots/service.test.ts#L239)
- [remove() resolves a symlinked spelling of a root whose directory was deleted](tests/roots/service.test.ts#L247)
- [removing one of two same-basename roots restores the plain name on the survivor](tests/roots/service.test.ts#L260)
- [onChange receives {added, removed, roots} once per effective mutation](tests/roots/service.test.ts#L275)
- [unsubscribe stops further delivery](tests/roots/service.test.ts#L292)
- [an async listener is awaited before add() resolves](tests/roots/service.test.ts#L303)

### search

#### [controller-results.test.ts](tests/search/controller-results.test.ts) (2 declarations)

- [search().results parses under its output schema, idempotently](tests/search/controller-results.test.ts#L95)
- [every result is inside a root, is a .md/.mdx doc from the tree, capped at 30, and a nonce word is found](tests/search/controller-results.test.ts#L133)

#### [controller.test.ts](tests/search/controller.test.ts) (1 declarations)

- [finds a fixture word and every result has a numeric score](tests/search/controller.test.ts#L35)

#### [frontmatter.test.ts](tests/search/frontmatter.test.ts) (1 declarations)

- [uses visible titles and excerpts and excludes YAML from search (%j)](tests/search/frontmatter.test.ts#L9)

#### [service-index-sync.test.ts](tests/search/service-index-sync.test.ts) (3 declarations)

- [after any add/edit/delete sequence, the incrementally-synced index agrees with a fresh SearchService over the same tree, per doc (order not asserted — see comment above)](tests/search/service-index-sync.test.ts#L102)
- [every result's label is `<rootName>/<relative path>`, and an empty query returns tree order](tests/search/service-index-sync.test.ts#L189)
- [changing rootInfo.name between calls re-labels every hit while leaving the doc set unchanged](tests/search/service-index-sync.test.ts#L219)

#### [service.test.ts](tests/search/service.test.ts) (1 declarations)

- [re-labels an unchanged doc when its root's display name changes](tests/search/service.test.ts#L20)

### servers

#### [bind-host.test.ts](tests/servers/bind-host.test.ts) (4 declarations)

- [defaults loopback %s to full permissions](tests/servers/bind-host.test.ts#L5)
- [defaults non-loopback %s to restricted despite the dangerous flag](tests/servers/bind-host.test.ts#L25)
- [rejects an unknown permissions mode before binding](tests/servers/bind-host.test.ts#L62)
- [only defaults IPv4 loopback addresses to full](tests/servers/bind-host.test.ts#L70)

#### [lock.test.ts](tests/servers/lock.test.ts) (14 declarations)

- [acquires a fresh lockfile and writes our own pid](tests/servers/lock.test.ts#L34)
- [a second ServerLock on the same path reports held with our pid](tests/servers/lock.test.ts#L41)
- [steals a lockfile written by a dead pid](tests/servers/lock.test.ts#L49)
- [never steals a live pid's lock because of its age (no mtime-based staleness)](tests/servers/lock.test.ts#L58)
- [treats a pid with trailing junk, a negative pid, or pid 0 as garbage, never as a live pid](tests/servers/lock.test.ts#L70)
- [steals garbage content once it is old enough not to be mid-write](tests/servers/lock.test.ts#L87)
- [refuses to steal garbage content that is still fresh (a starter mid-write)](tests/servers/lock.test.ts#L96)
- [release removes the file](tests/servers/lock.test.ts#L104)
- [release is idempotent](tests/servers/lock.test.ts#L112)
- [release leaves a lockfile that now holds a foreign pid untouched](tests/servers/lock.test.ts#L121)
- [creates the parent directory when it does not exist](tests/servers/lock.test.ts#L131)
- [reports an error when the parent directory is unwritable](tests/servers/lock.test.ts#L138)
- [at most one instance holds the lock at a time, and the file exists iff someone holds it](tests/servers/lock.test.ts#L157)
- [acquire succeeds on any stale content with an old mtime](tests/servers/lock.test.ts#L198)

#### [mounted-roots.test.ts](tests/servers/mounted-roots.test.ts) (5 declarations)

- [reports no-server from the registry alone](tests/servers/mounted-roots.test.ts#L20)
- [prefers the live server's roots over the registry snapshot](tests/servers/mounted-roots.test.ts#L25)
- [falls back to the snapshot when the server cannot be reached](tests/servers/mounted-roots.test.ts#L44)
- [surfaces a server error](tests/servers/mounted-roots.test.ts#L50)
- [reads the registry row fresh on every call](tests/servers/mounted-roots.test.ts#L61)

#### [registry.test.ts](tests/servers/registry.test.ts) (12 declarations)

- [registers a server and finds it via current()](tests/servers/registry.test.ts#L54)
- [registering twice replaces the row: current() is the second, and only one row exists](tests/servers/registry.test.ts#L66)
- [updateRoots with the current owner's pid is visible on current()](tests/servers/registry.test.ts#L73)
- [updateRoots with a foreign pid is ignored](tests/servers/registry.test.ts#L79)
- [unregister with a foreign pid is ignored](tests/servers/registry.test.ts#L85)
- [unregister with the owning pid clears the row](tests/servers/registry.test.ts#L91)
- [a dead pid's row is pruned: current() is undefined, and it stays gone](tests/servers/registry.test.ts#L97)
- [malformed roots JSON comes back as roots: \[\], keeping pid/port/host](tests/servers/registry.test.ts#L106)
- [migrates away from a legacy `servers` table on first open](tests/servers/registry.test.ts#L117)
- [register -> current round-trips an arbitrary record](tests/servers/registry.test.ts#L168)
- [updateRoots is idempotent](tests/servers/registry.test.ts#L184)
- [a random sequence of register/updateRoots/unregister matches a tiny in-memory model](tests/servers/registry.test.ts#L213)

#### [remote.test.ts](tests/servers/remote.test.ts) (18 declarations)

- [normalizes a wildcard IPv4 bind address to loopback](tests/servers/remote.test.ts#L14)
- [normalizes a wildcard IPv6 bind address to loopback](tests/servers/remote.test.ts#L18)
- [brackets a concrete IPv6 host](tests/servers/remote.test.ts#L22)
- [passes a concrete LAN host through unchanged](tests/servers/remote.test.ts#L26)
- [the base URL parses and its port round-trips](tests/servers/remote.test.ts#L30)
- [validateDoc: ok](tests/servers/remote.test.ts#L125)
- [searchDocs: ok](tests/servers/remote.test.ts#L134)
- [listDocs without a path: ok, lists the outer root](tests/servers/remote.test.ts#L143)
- [listDocs with a path: ok, lists that subtree](tests/servers/remote.test.ts#L152)
- [listRoots: ok, with the fixture root](tests/servers/remote.test.ts#L161)
- [addRoots then removeRoots round trip a second directory](tests/servers/remote.test.ts#L170)
- [getServer undefined: unavailable for all six, without connecting](tests/servers/remote.test.ts#L202)
- [a dead port reports unavailable](tests/servers/remote.test.ts#L212)
- [a port change between calls reaches the new server](tests/servers/remote.test.ts#L224)
- [searchDocs surfaces the server's error message](tests/servers/remote.test.ts#L284)
- [listRoots surfaces the server's error message](tests/servers/remote.test.ts#L290)
- [any TRPCClientError with a data.code becomes an error carrying the message](tests/servers/remote.test.ts#L298)
- [any other value becomes unavailable](tests/servers/remote.test.ts#L311)

### setup

#### [diagrams.test.ts](tests/setup/diagrams.test.ts) (5 declarations)

- [automatically initializes missing preferences once, including overlapping calls](tests/setup/diagrams.test.ts#L29)
- [preserves configured %s and model overrides without probing or writing](tests/setup/diagrams.test.ts#L46)
- [initializes Disabled when no agent is ready without repeating work on rerun](tests/setup/diagrams.test.ts#L62)
- [preserves settings saved while detection was in progress](tests/setup/diagrams.test.ts#L72)
- [allows retry after detection failure without saving a partial setup](tests/setup/diagrams.test.ts#L83)

#### [plan-commands.test.ts](tests/setup/plan-commands.test.ts) (1 declarations)

- [lists skills first (iff present), then available cleanups in order](tests/setup/plan-commands.test.ts#L8)

#### [plan.test.ts](tests/setup/plan.test.ts) (5 declarations)

- [ignores folders without SKILL.md, sorts, and tolerates a missing dir](tests/setup/plan.test.ts#L19)
- [has the exact MCP cleanup argv](tests/setup/plan.test.ts#L33)
- [builds the skills install command](tests/setup/plan.test.ts#L40)
- [plans skills first, then cleanups for available clients](tests/setup/plan.test.ts#L60)
- [plans nothing when there are no skills and no clients](tests/setup/plan.test.ts#L71)

#### [runner.test.ts](tests/setup/runner.test.ts) (3 declarations)

- [returns the exit code without throwing](tests/setup/runner.test.ts#L7)
- [captures stderr](tests/setup/runner.test.ts#L14)
- [finds node and not a missing binary](tests/setup/runner.test.ts#L21)

#### [service-outcomes.test.ts](tests/setup/service-outcomes.test.ts) (3 declarations)

- [installs available skills and skips missing clients](tests/setup/service-outcomes.test.ts#L32)
- [isolates cleanup failures; only the skills exit code decides ok vs error](tests/setup/service-outcomes.test.ts#L72)
- [is idempotent: two runs yield identical logs](tests/setup/service-outcomes.test.ts#L109)

#### [service.test.ts](tests/setup/service.test.ts) (4 declarations)

- [installs skills and removes old MCP registrations](tests/setup/service.test.ts#L24)
- [reports an error with stderr when the skills install fails](tests/setup/service.test.ts#L39)
- [skips skills when none ship and marks missing clients](tests/setup/service.test.ts#L50)
- [treats a failing cleanup as absent](tests/setup/service.test.ts#L65)

### trash

#### [controller-batches.test.ts](tests/trash/controller-batches.test.ts) (3 declarations)

- [every input path lands in exactly one of deleted or failed, in the order it was given](tests/trash/controller-batches.test.ts#L97)
- [exactly the servable docs inside a root are trashed; nothing else is even attempted](tests/trash/controller-batches.test.ts#L125)
- [re-running a batch is a no-op: everything already trashed now fails as Not found](tests/trash/controller-batches.test.ts#L154)

#### [controller.test.ts](tests/trash/controller.test.ts) (7 declarations)

- [trashes the requested docs and reports them as deleted](tests/trash/controller.test.ts#L55)
- [refuses non-document files and leaves their contents intact](tests/trash/controller.test.ts#L67)
- [reports each failure with its own path and reason, in the order asked for](tests/trash/controller.test.ts#L75)
- [partitions a mixed batch instead of failing it whole](tests/trash/controller.test.ts#L91)
- [rejects an empty batch at the schema, before any file is touched](tests/trash/controller.test.ts#L100)
- [rejects a batch over the 500-path cap at the schema](tests/trash/controller.test.ts#L107)
- [is rejected as a cross-origin write, being a mutation](tests/trash/controller.test.ts#L117)

#### [service-batches.test.ts](tests/trash/service-batches.test.ts) (2 declarations)

- [deleted + failed is a permutation of the input, in-order within each bucket, duplicates counted twice](tests/trash/service-batches.test.ts#L137)
- [every path handed to trashFile is a real, root-contained, all-servable file](tests/trash/service-batches.test.ts#L180)

#### [service.test.ts](tests/trash/service.test.ts) (6 declarations)

- [deletes a real file via the injected trashFile spy](tests/trash/service.test.ts#L29)
- [fails a directory with 'Is a directory'](tests/trash/service.test.ts#L40)
- [fails an outside-root path with 'Invalid path'](tests/trash/service.test.ts#L50)
- [fails a dotfile with 'Invalid path'](tests/trash/service.test.ts#L60)
- [never trashes a non-document file](tests/trash/service.test.ts#L70)
- [fails a path through a symlink that escapes the root with 'Invalid path'](tests/trash/service.test.ts#L81)

### validation

#### [controller-locality.test.ts](tests/validation/controller-locality.test.ts) (1 declarations)

- [rendered is exactly ctx.isLoopback, and the render stub only runs when isLoopback](tests/validation/controller-locality.test.ts#L27)

#### [controller.test.ts](tests/validation/controller.test.ts) (3 declarations)

- [isLoopback: false never runs the render stub (rendered: false)](tests/validation/controller.test.ts#L43)
- [isLoopback: true runs the render stub (rendered: true)](tests/validation/controller.test.ts#L51)
- [throws NOT_FOUND for a path outside every root](tests/validation/controller.test.ts#L59)

#### [extension-parity.test.ts](tests/validation/extension-parity.test.ts) (1 declarations)

- [validates $name the same way as .md and .mdx](tests/validation/extension-parity.test.ts#L23)

#### [service-rendering.test.ts](tests/validation/service-rendering.test.ts) (3 declarations)

- [rendered is always false and the render port is never called](tests/validation/service-rendering.test.ts#L32)
- [rendered is true iff there is no static error diagnostic, and render-error diagnostics only appear when rendered](tests/validation/service-rendering.test.ts#L63)
- [validateDoc({path}) deep-equals validateText({source: readFile(path), absPath: realpath}) for the same file and allowRender](tests/validation/service-rendering.test.ts#L101)

#### [service.test.ts](tests/validation/service.test.ts) (27 declarations)

- [passes a plain doc with no diagnostics](tests/validation/service.test.ts#L49)
- [passes a doc using a registered component with valid props](tests/validation/service.test.ts#L57)
- [reports an unknown component as an error, with a did-you-mean suggestion](tests/validation/service.test.ts#L65)
- [reports an unknown prop on a known component](tests/validation/service.test.ts#L79)
- [reports MDX that does not compile, with a line number](tests/validation/service.test.ts#L89)
- [reports a relative import that resolves to nothing](tests/validation/service.test.ts#L99)
- [reports a path outside every root as not-found, without reading it](tests/validation/service.test.ts#L109)
- [reports a missing file as not-found](tests/validation/service.test.ts#L116)
- [resolves a root-relative path when exactly one root has that file](tests/validation/service.test.ts#L124)
- [runs the render step only when allowRender is true](tests/validation/service.test.ts#L135)
- [turns a failed render into a render-error diagnostic](tests/validation/service.test.ts#L148)
- [does not render a doc that already failed the static checks](tests/validation/service.test.ts#L162)
- [reports rendered: false when allowRender is true but no render port exists](tests/validation/service.test.ts#L170)
- [reports a mermaid-chart error for a %s fence, at the fence's opening line](tests/validation/service.test.ts#L178)
- [a flowchart and a sequence diagram produce no diagnostics](tests/validation/service.test.ts#L198)
- [a fence starting with pie but tagged as text is not flagged](tests/validation/service.test.ts#L222)
- [two pie fences report two diagnostics at distinct lines](tests/validation/service.test.ts#L233)
- [a .md doc with `a < b` above the fence still reports the true line](tests/validation/service.test.ts#L261)
- [validates text that is not what is on disk, against the given path](tests/validation/service.test.ts#L275)
- [defaults to not rendering when allowRender is omitted](tests/validation/service.test.ts#L286)
- [resolves relative imports against the given path's directory](tests/validation/service.test.ts#L294)
- [a plain doc has an empty hints array](tests/validation/service.test.ts#L307)
- [an image whose alt text mentions 'screen' gets a <Screenshot> hint with its line](tests/validation/service.test.ts#L315)
- [an image whose path mentions 'screen' gets the hint too, case-insensitively](tests/validation/service.test.ts#L326)
- [several screenshot images collapse into one hint listing every line](tests/validation/service.test.ts#L335)
- [an already-framed <Screenshot> is not hinted about](tests/validation/service.test.ts#L348)
- [a doc that fails to compile has no hints](tests/validation/service.test.ts#L359)

#### [validate-diagnostics.test.ts](tests/validation/validate-diagnostics.test.ts) (24 declarations)

- [GFM-only docs produce no diagnostics from analyzeTree](tests/validation/validate-diagnostics.test.ts#L81)
- [GFM-only docs validate ok via validateSource](tests/validation/validate-diagnostics.test.ts#L90)
- [reports exactly one unknown-component diagnostic per injected name, at the right line](tests/validation/validate-diagnostics.test.ts#L108)
- [imported names are excluded; the rest still get exactly one diagnostic](tests/validation/validate-diagnostics.test.ts#L140)
- [using only a subset of a component's own props yields no unknown-prop diagnostics](tests/validation/validate-diagnostics.test.ts#L178)
- [an attribute name outside the component's props (and not children/key) yields exactly one unknown-prop](tests/validation/validate-diagnostics.test.ts#L195)
- [never produces diagnostics for html-style lowercase tags](tests/validation/validate-diagnostics.test.ts#L216)
- [an unclosed <Callout> is a single mdx-compile error with a numeric line](tests/validation/validate-diagnostics.test.ts#L230)
- [a bare `<` before a digit is accepted by both .md and .mdx](tests/validation/validate-diagnostics.test.ts#L243)
- [a plain Error has no line](tests/validation/validate-diagnostics.test.ts#L264)
- [binds ${…} from \\`${…}\\`](tests/validation/validate-diagnostics.test.ts#L282)
- [reports <Builtin.Member> as unknown and does not check its props](tests/validation/validate-diagnostics.test.ts#L291)
- [leaves <Local.Member> alone when Local is imported](tests/validation/validate-diagnostics.test.ts#L298)
- [a render failure yields exactly one render-error diagnostic, ok:false, rendered:true](tests/validation/validate-diagnostics.test.ts#L339)
- [render is not called when a static error already exists](tests/validation/validate-diagnostics.test.ts#L362)
- [for docs with no `{`/`<` at all that validate ok statically, a passing render never flips ok, and render-error only appears when rendered:true](tests/validation/validate-diagnostics.test.ts#L379)
- [no render-error diagnostic is ever present when rendered is false](tests/validation/validate-diagnostics.test.ts#L406)
- [points at the import statement](tests/validation/validate-diagnostics.test.ts#L419)
- [injecting k chart fences yields exactly k mermaid-chart diagnostics at the right lines](tests/validation/validate-diagnostics.test.ts#L452)
- [injecting non-chart mermaid fences adds no mermaid-chart diagnostics](tests/validation/validate-diagnostics.test.ts#L484)
- [GFM-only docs (no images) produce no hints](tests/validation/validate-diagnostics.test.ts#L533)
- [images whose alt and path avoid 'screen' produce no hints](tests/validation/validate-diagnostics.test.ts#L541)
- [injecting k screenshot-looking images yields exactly one hint that names every line and <Screenshot>](tests/validation/validate-diagnostics.test.ts#L554)
- [validateSource carries the same hints, and they never affect ok](tests/validation/validate-diagnostics.test.ts#L576)
