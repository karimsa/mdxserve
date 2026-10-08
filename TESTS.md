# Test inventory and feature coverage

This file inventories **83 test files and 589 declared test cases** in `tests/` and evaluates the suite against observable behavior. Generated inputs still use `fast-check` where they help; filenames describe the feature or guarantee rather than the test technique. Run the service suite with `yarn test` and the real browser journeys with `yarn test:browser` after installing Chromium (`yarn playwright install chromium`).

## Assessment

The strongest existing tests exercise real files and documented results: document saving and conflict handling, root containment, folder listing, HTTP method and origin checks, server lock and registry behavior, search index updates, and render worker recovery. Fakes are appropriate at an explicit port, such as the bundle function or command runner, when a separate test exercises the real adapter.

This pass removed assertions that could fail after a harmless implementation change: exact CSS directive counts, a Vite config array, metadata punctuation, obsolete CLI wording, a spy on Node's `readSync`, and a service test that used the production planner as its own expected answer. It also removed a vacuous export case that asserted only inside `catch`. The trash controller fake now moves fixtures to a recovery directory and checks their bytes; it no longer permanently deletes them. The document trash action rejects non-document files in both the service and UI.

The old validation case claimed bare `<` should behave differently in `.md` and `.mdx`; the paired cases now require the same diagnostics. The render pipeline uses the same lenient parsing for both. Real browser tests complement the previously canned export results by opening exported HTML and verifying visible content.

### Remaining weak spots

- Search index tests intentionally compare result sets and scores without a stable order for ties. If stable tie ordering becomes a product promise, the sort rule and its acceptance test should be added together.
- The real OS Trash location is platform managed. The controller tests prove the move contract with a recovery directory, while browser coverage currently proves cancellation and eligible selection. Recovery from the OS Trash UI remains unverified.
- A live remote network connection, native save picker cancellation, and a real `setup` run depend on host capabilities and are not covered by the local browser suite. Their service/API checks remain, but these end-to-end guarantees need dedicated environments.

## Feature acceptance record

Each row is a user-visible behavior to verify. **Covered** means a direct journey was added or already exists; **partial** names the remaining acceptance surface. These records do not call for tests of private state, CSS structure, hook calls, or a particular implementation.

| ID  | Feature                           | Current acceptance coverage                                                                                                                                 | Remaining surface                                                               |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| F01 | Starting and finding a server     | Browser suite starts the executable with a root, reads `status` and `status --json`, rejects a duplicate, and verifies the first server still responds.     | Zero-root startup and busy-port fallback through the CLI.                       |
| F02 | Live root changes                 | Browser suite adds a root, sees it in the viewer, removes the root of the open document, and reaches a usable remaining root.                               | Initial zero-root viewer becoming populated.                                    |
| F03 | Browser navigation                | Browser suite follows document links, Back/Forward, table of contents, and next-page link.                                                                  | —                                                                               |
| F04 | Live file changes                 | Browser suite sees an external edit and a folder add/rename without reload.                                                                                 | Explicit removal from an open folder and change toast.                          |
| F05 | In-place section editing          | Browser suite saves with the keyboard, checks disk bytes, and cancels with Escape; service tests cover stale versions and invalid content preserving bytes. | Browser feedback for concurrent/invalid saves.                                  |
| F06 | Recoverable bulk trash            | Browser suite selects only documents and cancels without a write; service/controller tests partition failures and retain moved bytes in a recovery fixture. | Real OS Trash recovery and mixed-result UI.                                     |
| F07 | `.md` and `.mdx` parity           | Paired validation cases cover GFM, JSX, imports, literal `<`, and malformed source; browser suite renders a neighboring component from both extensions.     | Paired edit and export journey.                                                 |
| F08 | Standalone export                 | Browser suite runs the CLI with no server and opens the resulting `file://` HTML with a table and working Tabs.                                             | Relative images, code styling, and Mermaid modes in the exported file.          |
| F09 | Viewer export                     | Browser suite downloads from the top bar and opens the saved HTML.                                                                                          | Native picker cancellation and failed-build destination preservation.           |
| F10 | LAN read and local privileges     | HTTP/controller tests cover origin, host, and caller locality.                                                                                              | Real remote-interface connection with read allowed and mutations/render denied. |
| F11 | Viewer search                     | Browser suite filters body text and opens the selected result with Enter; service tests cover indexing and excerpts.                                        | Arrow and Escape keys, and across-root results.                                 |
| F12 | Folder listing                    | Browser suite proves non-doc files cannot be selected for trash and selection cancel preserves bytes.                                                       | Visible sort and age selection journey.                                         |
| F13 | Reader navigation                 | Browser suite follows a table of contents item and next-page card.                                                                                          | Breadcrumb and active-heading scroll tracking.                                  |
| F14 | Rich document display             | Browser suite checks a table and Callout in the live reader and standalone file.                                                                            | Syntax highlighting, images, and visible error states.                          |
| F15 | Custom components                 | Browser suite imports a neighboring component in both `.md` and `.mdx`.                                                                                     | A local name overriding a builtin.                                              |
| F16 | Interactive builtins and diagrams | Browser suite switches a Tabs panel in the live reader and standalone file.                                                                                 | Mermaid fullscreen/code/direction controls.                                     |
| F17 | Reader preferences and print      | Browser suite persists dark mode and checks print media hides controls while leaving document content visible.                                              | Reader width and reduced-motion navigation.                                     |
| F18 | Agent-facing commands             | Browser suite runs `cache clean` twice through the executable; package smoke runs installed commands.                                                       | Safe real `setup` rerun in a controlled tool environment.                       |

## Complete case inventory

Each bullet links to the declaration in the current source. A declaration with generated inputs may execute many examples. This inventory is intentionally about the case's promise, not whether it uses generated or example inputs.

### api

#### [router.test.ts](tests/api/router.test.ts) (3 declarations)

- [exposes the documented procedures with descriptions](tests/api/router.test.ts#L53)
- [rejects mutations from a mismatched Origin with FORBIDDEN, but not queries](tests/api/router.test.ts#L70)
- [accepts a matching Origin, an absent Origin, and rejects an unparsable one](tests/api/router.test.ts#L79)

### browser

#### [features.test.ts](tests/browser/features.test.ts) (16 declarations)

- [renders a neighboring component from both Markdown extensions](tests/browser/features.test.ts#L151)
- [updates mounted roots in an open viewer and leaves removed documents](tests/browser/features.test.ts#L164)
- [reports the live server through the executable and refuses a duplicate](tests/browser/features.test.ts#L187)
- [cleans a populated cache through the executable and can be repeated](tests/browser/features.test.ts#L197)
- [renders rich content and switches an interactive tab](tests/browser/features.test.ts#L207)
- [opens a CLI standalone export as a local HTML page](tests/browser/features.test.ts#L228)
- [downloads a viewer export that opens as a local HTML page](tests/browser/features.test.ts#L262)
- [selects only documents for bulk trash and preserves them on cancel](tests/browser/features.test.ts#L289)
- [navigates folders and documents with browser history](tests/browser/features.test.ts#L310)
- [shows a usable route back from a missing document](tests/browser/features.test.ts#L326)
- [uses the table of contents and next page link](tests/browser/features.test.ts#L338)
- [searches by body text and opens the selected result](tests/browser/features.test.ts#L356)
- [saves and cancels an in-place section edit](tests/browser/features.test.ts#L373)
- [updates an open document after an external save](tests/browser/features.test.ts#L405)
- [updates an open folder when a document is added and renamed](tests/browser/features.test.ts#L420)
- [persists a selected theme and hides controls for print](tests/browser/features.test.ts#L441)

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
- [prints each hint as a \`hint:\` line after the render status, on an OK result](tests/cli/format.test.ts#L27)
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

#### [smoke.test.ts](tests/cli/smoke.test.ts) (1 declarations)

- [lists the agent-facing verbs](tests/cli/smoke.test.ts#L8)

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

#### [chart-bins.test.ts](tests/client/chart-bins.test.ts) (16 declarations)

- [bin counts sum to the number of finite values](tests/client/chart-bins.test.ts#L31)
- [puts every finite value in exactly one bin's [start, end) range (end inclusive on the last)](tests/client/chart-bins.test.ts#L42)
- [has contiguous, monotonic edges spanning [min, max]](tests/client/chart-bins.test.ts#L60)
- [uses equal-width bins when the range is non-degenerate](tests/client/chart-bins.test.ts#L75)
- [respects an explicit bin count (clamped to 50) when non-degenerate, else falls back to autoBinCount](tests/client/chart-bins.test.ts#L89)
- [collapses a zero-width range to one bin holding every value](tests/client/chart-bins.test.ts#L109)
- [returns [] for values with no finite entries](tests/client/chart-bins.test.ts#L120)
- [gives every bin a non-empty label](tests/client/chart-bins.test.ts#L138)
- [is >= the input, > 0, with an integer mantissa in [1, 10]](tests/client/chart-bins.test.ts#L148)
- [is idempotent on integer input](tests/client/chart-bins.test.ts#L166)
- [is strictly increasing from 0 to max, with at most \`desired\` ticks](tests/client/chart-bins.test.ts#L177)
- [does not depend on label order](tests/client/chart-bins.test.ts#L197)
- [stays within [min, max]](tests/client/chart-bins.test.ts#L212)
- [never shrinks when a longer label is added](tests/client/chart-bins.test.ts#L228)
- [returns the label unchanged when it fits, else a prefix of it plus an ellipsis](tests/client/chart-bins.test.ts#L246)
- [is strictly increasing, includes both ends, and stays in range](tests/client/chart-bins.test.ts#L267)

#### [chart-data.test.ts](tests/client/chart-data.test.ts) (17 declarations)

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
- [returns [] for an empty or all-NaN input](tests/client/chart-data.test.ts#L74)
- [returns one bin holding everything for a single value](tests/client/chart-data.test.ts#L79)
- [returns one bin of the full count for a zero-width range](tests/client/chart-data.test.ts#L85)
- [respects an explicit bin count, clamped to 50](tests/client/chart-data.test.ts#L91)
- [clamps to the given bounds](tests/client/chart-data.test.ts#L103)
- [leaves a label unchanged when it fits](tests/client/chart-data.test.ts#L116)
- [truncates with an ellipsis when it doesn't fit](tests/client/chart-data.test.ts#L120)

#### [editor-link.test.ts](tests/client/editor-link.test.ts) (6 declarations)

- [returns the href for a cmd+click on a link](tests/client/editor-link.test.ts#L13)
- [returns the href for a ctrl+click on a link](tests/client/editor-link.test.ts#L19)
- [leaves a plain click alone so the caret can land inside the link text](tests/client/editor-link.test.ts#L25)
- [ignores clicks that are not the primary button](tests/client/editor-link.test.ts#L29)
- [ignores a modified click that is not on a link](tests/client/editor-link.test.ts#L38)
- [opens only when the primary button carries cmd or ctrl, for any href](tests/client/editor-link.test.ts#L44)

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

#### [mermaid-chart-detection.test.ts](tests/client/mermaid-chart-detection.test.ts) (7 declarations)

- [recognizes every chart keyword through indent, args, preamble, and body noise](tests/client/mermaid-chart-detection.test.ts#L71)
- [never matches a generated flowchart/other-diagram header](tests/client/mermaid-chart-detection.test.ts#L81)
- [a chart keyword appearing only in the body (never the header) stays null](tests/client/mermaid-chart-detection.test.ts#L90)
- [a keyword directly followed by more identifier characters is not recognised](tests/client/mermaid-chart-detection.test.ts#L101)
- [a keyword followed by whitespace is recognised regardless of what follows](tests/client/mermaid-chart-detection.test.ts#L109)
- [a recognised chart source never reads as a flowchart direction](tests/client/mermaid-chart-detection.test.ts#L123)
- [always names the keyword and <Chart>](tests/client/mermaid-chart-detection.test.ts#L133)

#### [mermaid-chart.test.ts](tests/client/mermaid-chart.test.ts) (10 declarations)

- [recognizes ${keyword} in a realistic diagram](tests/client/mermaid-chart.test.ts#L18)
- [recognizes ${keyword} indented](tests/client/mermaid-chart.test.ts#L22)
- [recognizes ${keyword} with a trailing comment on the header line](tests/client/mermaid-chart.test.ts#L26)
- [returns null for ${JSON.stringify(source.slice(0, 20))}](tests/client/mermaid-chart.test.ts#L50)
- [returns null for ${nearMiss}](tests/client/mermaid-chart.test.ts#L60)
- [returns null when a chart keyword appears only in the body](tests/client/mermaid-chart.test.ts#L67)
- [skips a closed front-matter block](tests/client/mermaid-chart.test.ts#L73)
- [skips a multi-line %%{init}%% directive](tests/client/mermaid-chart.test.ts#L78)
- [returns null for an unclosed front-matter block](tests/client/mermaid-chart.test.ts#L85)
- [names ${keyword} and <Chart>](tests/client/mermaid-chart.test.ts#L93)

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

#### [route-path.test.ts](tests/client/route-path.test.ts) (4 declarations)

- [decodes a percent-encoded pathname](tests/client/route-path.test.ts#L6)
- [leaves an already-decoded pathname alone](tests/client/route-path.test.ts#L11)
- [keeps a pathname with a stray percent sign rather than throwing](tests/client/route-path.test.ts#L15)
- [inverts encodeURI for any path made of unreserved and space characters](tests/client/route-path.test.ts#L19)

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
- [carries \`children\` through for a component that takes children](tests/components/controller.test.ts#L45)
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

- [splicing [s, e] with exactly its own lines is the identity](tests/docs/edit-line-ranges.test.ts#L89)
- [lines before start and after end are unchanged; EOL and trailing-newline state are preserved](tests/docs/edit-line-ranges.test.ts#L104)
- [output line count = input - (end - start + 1) + replacement line count](tests/docs/edit-line-ranges.test.ts#L130)
- [splicing the later range first equals splicing the earlier one first, with the later range shifted](tests/docs/edit-line-ranges.test.ts#L178)
- [an invalid [start, end] never throws and always reports ok: false](tests/docs/edit-line-ranges.test.ts#L206)
- [examples: below-range start, above-range end, inverted range, and a non-integer all fail cleanly](tests/docs/edit-line-ranges.test.ts#L231)

#### [service-save.test.ts](tests/docs/service-save.test.ts) (3 declarations)

- [readSource after saveSection matches the spliceLines oracle, for either EOL style and trailing-newline state](tests/docs/service-save.test.ts#L54)
- [a stale version, an out-of-range line range, and invalid markdown all leave the file byte-identical, with no leftover .*.mdxserve-tmp file](tests/docs/service-save.test.ts#L103)
- [two concurrent saves on one instance with the same original version: exactly one ok, the other stale](tests/docs/service-save.test.ts#L168)

#### [service.test.ts](tests/docs/service.test.ts) (16 declarations)

- [returns the raw on-disk text with a version token for those bytes](tests/docs/service.test.ts#L39)
- [reports a path outside every root as not-found](tests/docs/service.test.ts#L47)
- [reports a missing file as not-found](tests/docs/service.test.ts#L53)
- [refuses a file over the editor size cap, reporting its size](tests/docs/service.test.ts#L57)
- [replaces exactly the requested line range and returns the new version](tests/docs/service.test.ts#L69)
- [returns a version the next save can immediately use](tests/docs/service.test.ts#L82)
- [rejects a version that no longer matches the file, handing back the current one](tests/docs/service.test.ts#L104)
- [catches a change an mtime check would miss, because it compares bytes](tests/docs/service.test.ts#L117)
- [accepts a save when the file was edited back to the bytes it was read at](tests/docs/service.test.ts#L134)
- [rejects a line range past the end of the file without writing](tests/docs/service.test.ts#L147)
- [rejects markdown that would break the doc, reporting the diagnostics, without writing](tests/docs/service.test.ts#L159)
- [rejects a section save that introduces a mermaid pie fence, without writing](tests/docs/service.test.ts#L173)
- [reports a path outside every root as not-found](tests/docs/service.test.ts#L187)
- [leaves no staging file behind, on success or on rejection](tests/docs/service.test.ts#L201)
- [writes through a symlink to its target, leaving the link a link](tests/docs/service.test.ts#L220)
- [preserves the file's mode across the atomic replace](tests/docs/service.test.ts#L235)

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

- [result.mermaid follows the fence/requested-mode rule and the port receives the same mode](tests/export/service-output.test.ts#L38)
- [build never changes the fixture directory's file list or any file's bytes](tests/export/service-output.test.ts#L82)
- [fileName never contains a path separator, always ends in .html, and its stem matches the source basename](tests/export/service-output.test.ts#L124)
- [export() then reading outFile equals build().contents exactly, and bytes equals the on-disk size](tests/export/service-output.test.ts#L170)
- [a path escaping rootDirs (via .. or an absolute path under a different tmp dir) is not-found and never invokes the port](tests/export/service-output.test.ts#L227)
- [build never throws, and its kind is always one of the five declared members](tests/export/service-output.test.ts#L262)

#### [service.test.ts](tests/export/service.test.ts) (15 declarations)

- [builds an ok result from the fake bundle port](tests/export/service.test.ts#L69)
- [build leaves the directory listing byte-identical](tests/export/service.test.ts#L84)
- [export writes outFile with bytes equal to build().contents](tests/export/service.test.ts#L96)
- [returns not-found for a missing file](tests/export/service.test.ts#L121)
- [returns not-a-doc for a non-markdown extension](tests/export/service.test.ts#L128)
- [returns unsupported-format for an unknown format](tests/export/service.test.ts#L135)
- [returns bundle-failed with the port's error message when the port rejects](tests/export/service.test.ts#L145)
- [a doc in a different root than rootDirs is not-found and never calls the bundle port](tests/export/service.test.ts#L154)
- [an escaping symlink is not-found](tests/export/service.test.ts#L162)
- [no rootDirs at all accepts an absolute path (CLI parity)](tests/export/service.test.ts#L172)
- [an empty rootDirs list (no folders served) resolves nothing and never calls the bundle port](tests/export/service.test.ts#L179)
- [forces mermaid to none for a doc with no fence, even when bundle is requested](tests/export/service.test.ts#L187)
- [forces mermaid to none for a pie-only doc, even when bundle is requested](tests/export/service.test.ts#L201)
- [still bundles mermaid for a doc mixing a chart fence with a real diagram](tests/export/service.test.ts#L215)
- [passes the requested mermaid mode through for a doc with a fence, defaulting to cdn](tests/export/service.test.ts#L229)

### http

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

#### [server.test.ts](tests/http/server.test.ts) (20 declarations)

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
- [renderShell(route) defaults to data-same-machine="0"](tests/http/server.test.ts#L256)
- [a loopback request for a doc URL gets a shell with data-same-machine="1"](tests/http/server.test.ts#L261)
- [addRoots is FORBIDDEN when a loopback request carries a foreign Host](tests/http/server.test.ts#L307)

#### [start.test.ts](tests/http/start.test.ts) (2 declarations)

- [reports already-running without port/host when no registry row exists yet](tests/http/start.test.ts#L30)
- [reports the registered port/host once the row exists](tests/http/start.test.ts#L46)

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

### rendering

#### [app-css.test.ts](tests/rendering/app-css.test.ts) (1 declarations)

- [includes the styles and source paths needed by served docs](tests/rendering/app-css.test.ts#L12)

#### [fs-allow.test.ts](tests/rendering/fs-allow.test.ts) (1 declarations)

- [denies a file outside fs.allow, then serves it once its directory is allowed](tests/rendering/fs-allow.test.ts#L49)

#### [inline-images.test.ts](tests/rendering/inline-images.test.ts) (3 declarations)

- [inlines a hast <img>, a JSX <img>, and a <Screenshot> src alike](tests/rendering/inline-images.test.ts#L42)
- [leaves a src on any other component alone](tests/rendering/inline-images.test.ts#L57)
- [keeps an absolute or remote Screenshot src as is, and warns on a missing file](tests/rendering/inline-images.test.ts#L63)

#### [lenient-md-syntax.test.ts](tests/rendering/lenient-md-syntax.test.ts) (4 declarations)

- [is idempotent](tests/rendering/lenient-md-syntax.test.ts#L6)
- [preserves line count](tests/rendering/lenient-md-syntax.test.ts#L16)
- [leaves text inside fenced code blocks unchanged](tests/rendering/lenient-md-syntax.test.ts#L30)
- [leaves text inside inline code spans unchanged](tests/rendering/lenient-md-syntax.test.ts#L46)

#### [remark-sections-structure.test.ts](tests/rendering/remark-sections-structure.test.ts) (10 declarations)

- [flattening every MdSection's children back in place reproduces the original children](tests/rendering/remark-sections-structure.test.ts#L123)
- [no MdSection subtree contains an mdx* node, html, definition, footnote*, linkReference, or imageReference](tests/rendering/remark-sections-structure.test.ts#L137)
- [two MdSections are never adjacent unless the second starts with a heading of depth <= 2](tests/rendering/remark-sections-structure.test.ts#L154)
- [ranges are ascending/non-overlapping and index attributes count 0..n-1 in order](tests/rendering/remark-sections-structure.test.ts#L170)
- [slicing the source at [startLine, endLine] and re-parsing reproduces the section's text](tests/rendering/remark-sections-structure.test.ts#L190)
- [a doc starting with \`---\` on line 1 has no section starting at line 1](tests/rendering/remark-sections-structure.test.ts#L210)
- [a doc that opens with a plain horizontal rule (blank line after it) stays editable from line 1](tests/rendering/remark-sections-structure.test.ts#L218)
- [an unclosed leading \`---\` is not front matter: the doc stays editable](tests/rendering/remark-sections-structure.test.ts#L225)
- [no section covers any front-matter line, whatever the block's shape](tests/rendering/remark-sections-structure.test.ts#L235)
- [heading+paragraph, then a JSX block, then a trailing paragraph yields exactly two sections](tests/rendering/remark-sections-structure.test.ts#L265)

#### [render-concurrency.test.ts](tests/rendering/render-concurrency.test.ts) (1 declarations)

- [N concurrent renders on one RenderService return N outcomes matched to their own docs](tests/rendering/render-concurrency.test.ts#L53)

#### [render.test.ts](tests/rendering/render.test.ts) (9 declarations)

- [reports a render-time ReferenceError with a matching line number](tests/rendering/render.test.ts#L61)
- [recovers a render queued behind a timed-out one](tests/rendering/render.test.ts#L73)
- [re-renders a doc from disk after it changes](tests/rendering/render.test.ts#L91)
- [renders ok once the identifier is bound](tests/rendering/render.test.ts#L108)
- [renders every builtin (including every Chart form), a fence, a GFM table, and a task list](tests/rendering/render.test.ts#L117)
- [times out on a document that hangs asynchronously](tests/rendering/render.test.ts#L172)
- [times out on a document with a synchronous infinite loop, without hanging the process](tests/rendering/render.test.ts#L193)
- [respawns a working worker after a prior render timed out](tests/rendering/render.test.ts#L207)
- [handles two concurrent renders on different documents](tests/rendering/render.test.ts#L220)

### roots

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

#### [paths.test.ts](tests/roots/paths.test.ts) (16 declarations)

- [resolves an absolute path with zero served roots](tests/roots/paths.test.ts#L46)
- [still rejects a non-.md/.mdx file with zero served roots](tests/roots/paths.test.ts#L52)
- [still rejects a path whose parent directory doesn't exist, with zero served roots](tests/roots/paths.test.ts#L59)
- [rejects a symlinked directory inside the root that points outside it](tests/roots/paths.test.ts#L66)
- [still accepts a plain file inside the root](tests/roots/paths.test.ts#L71)
- [accepts a symlinked doc whose target stays inside the root](tests/roots/paths.test.ts#L79)
- [rejects a symlinked doc whose target is outside the root](tests/roots/paths.test.ts#L84)
- [accepts a symlinked doc with no roots (nothing to be contained in)](tests/roots/paths.test.ts#L89)
- [resolveDocPath accepts a doc reached via the alias and reports the real root](tests/roots/paths.test.ts#L96)
- [resolveDirPath accepts a directory reached via the alias](tests/roots/paths.test.ts#L101)
- [accepts a real directory inside a root](tests/roots/paths.test.ts#L108)
- [rejects a symlinked directory that points outside the root](tests/roots/paths.test.ts#L113)
- [rejects files, missing paths, and paths outside every root](tests/roots/paths.test.ts#L118)
- [resolves literal, extensionless, and directory-index specifiers like Vite](tests/roots/paths.test.ts#L130)
- [expands a bare ~ and a leading ~/](tests/roots/paths.test.ts#L143)
- [leaves ~user, a mid-path ~, and ordinary paths alone](tests/roots/paths.test.ts#L149)

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

#### [service-index-sync.test.ts](tests/search/service-index-sync.test.ts) (3 declarations)

- [after any add/edit/delete sequence, the incrementally-synced index agrees with a fresh SearchService over the same tree, per doc (order not asserted — see comment above)](tests/search/service-index-sync.test.ts#L102)
- [every result's label is \`<rootName>/<relative path>\`, and an empty query returns tree order](tests/search/service-index-sync.test.ts#L189)
- [changing rootInfo.name between calls re-labels every hit while leaving the doc set unchanged](tests/search/service-index-sync.test.ts#L219)

#### [service.test.ts](tests/search/service.test.ts) (1 declarations)

- [re-labels an unchanged doc when its root's display name changes](tests/search/service.test.ts#L20)

### servers

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
- [malformed roots JSON comes back as roots: [], keeping pid/port/host](tests/servers/registry.test.ts#L106)
- [migrates away from a legacy \`servers\` table on first open](tests/servers/registry.test.ts#L117)
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

- [validates $name the same way as .md and .mdx](tests/validation/extension-parity.test.ts#L17)

#### [service-rendering.test.ts](tests/validation/service-rendering.test.ts) (3 declarations)

- [rendered is always false and the render port is never called](tests/validation/service-rendering.test.ts#L31)
- [rendered is true iff there is no static error diagnostic, and render-error diagnostics only appear when rendered](tests/validation/service-rendering.test.ts#L57)
- [validateDoc({path}) deep-equals validateText({source: readFile(path), absPath: realpath}) for the same file and allowRender](tests/validation/service-rendering.test.ts#L90)

#### [service.test.ts](tests/validation/service.test.ts) (27 declarations)

- [passes a plain doc with no diagnostics](tests/validation/service.test.ts#L43)
- [passes a doc using a registered component with valid props](tests/validation/service.test.ts#L51)
- [reports an unknown component as an error, with a did-you-mean suggestion](tests/validation/service.test.ts#L59)
- [reports an unknown prop on a known component](tests/validation/service.test.ts#L73)
- [reports MDX that does not compile, with a line number](tests/validation/service.test.ts#L83)
- [reports a relative import that resolves to nothing](tests/validation/service.test.ts#L93)
- [reports a path outside every root as not-found, without reading it](tests/validation/service.test.ts#L103)
- [reports a missing file as not-found](tests/validation/service.test.ts#L110)
- [resolves a root-relative path when exactly one root has that file](tests/validation/service.test.ts#L118)
- [runs the render step only when allowRender is true](tests/validation/service.test.ts#L129)
- [turns a failed render into a render-error diagnostic](tests/validation/service.test.ts#L142)
- [does not render a doc that already failed the static checks](tests/validation/service.test.ts#L156)
- [reports rendered: false when allowRender is true but no render port exists](tests/validation/service.test.ts#L164)
- [reports a mermaid-chart error for a %s fence, at the fence's opening line](tests/validation/service.test.ts#L172)
- [a flowchart and a sequence diagram produce no diagnostics](tests/validation/service.test.ts#L192)
- [a fence starting with pie but tagged as text is not flagged](tests/validation/service.test.ts#L216)
- [two pie fences report two diagnostics at distinct lines](tests/validation/service.test.ts#L227)
- [a .md doc with \`a < b\` above the fence still reports the true line](tests/validation/service.test.ts#L255)
- [validates text that is not what is on disk, against the given path](tests/validation/service.test.ts#L269)
- [defaults to not rendering when allowRender is omitted](tests/validation/service.test.ts#L280)
- [resolves relative imports against the given path's directory](tests/validation/service.test.ts#L288)
- [a plain doc has an empty hints array](tests/validation/service.test.ts#L301)
- [an image whose alt text mentions 'screen' gets a <Screenshot> hint with its line](tests/validation/service.test.ts#L309)
- [an image whose path mentions 'screen' gets the hint too, case-insensitively](tests/validation/service.test.ts#L320)
- [several screenshot images collapse into one hint listing every line](tests/validation/service.test.ts#L329)
- [an already-framed <Screenshot> is not hinted about](tests/validation/service.test.ts#L342)
- [a doc that fails to compile has no hints](tests/validation/service.test.ts#L353)

#### [validate-diagnostics.test.ts](tests/validation/validate-diagnostics.test.ts) (24 declarations)

- [GFM-only docs produce no diagnostics from analyzeTree](tests/validation/validate-diagnostics.test.ts#L80)
- [GFM-only docs validate ok via validateSource](tests/validation/validate-diagnostics.test.ts#L89)
- [reports exactly one unknown-component diagnostic per injected name, at the right line](tests/validation/validate-diagnostics.test.ts#L106)
- [imported names are excluded; the rest still get exactly one diagnostic](tests/validation/validate-diagnostics.test.ts#L138)
- [using only a subset of a component's own props yields no unknown-prop diagnostics](tests/validation/validate-diagnostics.test.ts#L176)
- [an attribute name outside the component's props (and not children/key) yields exactly one unknown-prop](tests/validation/validate-diagnostics.test.ts#L193)
- [never produces diagnostics for html-style lowercase tags](tests/validation/validate-diagnostics.test.ts#L214)
- [an unclosed <Callout> is a single mdx-compile error with a numeric line](tests/validation/validate-diagnostics.test.ts#L228)
- [a bare \`<\` before a digit is accepted by both .md and .mdx](tests/validation/validate-diagnostics.test.ts#L240)
- [a plain Error has no line](tests/validation/validate-diagnostics.test.ts#L259)
- [binds ${name} from \\`${esm}\\`](tests/validation/validate-diagnostics.test.ts#L277)
- [reports <Builtin.Member> as unknown and does not check its props](tests/validation/validate-diagnostics.test.ts#L286)
- [leaves <Local.Member> alone when Local is imported](tests/validation/validate-diagnostics.test.ts#L293)
- [a render failure yields exactly one render-error diagnostic, ok:false, rendered:true](tests/validation/validate-diagnostics.test.ts#L334)
- [render is not called when a static error already exists](tests/validation/validate-diagnostics.test.ts#L356)
- [for docs with no \`{\`/\`<\` at all that validate ok statically, a passing render never flips ok, and render-error only appears when rendered:true](tests/validation/validate-diagnostics.test.ts#L372)
- [no render-error diagnostic is ever present when rendered is false](tests/validation/validate-diagnostics.test.ts#L398)
- [points at the import statement](tests/validation/validate-diagnostics.test.ts#L410)
- [injecting k chart fences yields exactly k mermaid-chart diagnostics at the right lines](tests/validation/validate-diagnostics.test.ts#L442)
- [injecting non-chart mermaid fences adds no mermaid-chart diagnostics](tests/validation/validate-diagnostics.test.ts#L474)
- [GFM-only docs (no images) produce no hints](tests/validation/validate-diagnostics.test.ts#L523)
- [images whose alt and path avoid 'screen' produce no hints](tests/validation/validate-diagnostics.test.ts#L531)
- [injecting k screenshot-looking images yields exactly one hint that names every line and <Screenshot>](tests/validation/validate-diagnostics.test.ts#L544)
- [validateSource carries the same hints, and they never affect ok](tests/validation/validate-diagnostics.test.ts#L566)
