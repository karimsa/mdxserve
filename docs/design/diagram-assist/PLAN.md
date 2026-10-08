> Implementation update (2026-10-08): the exploratory options below are superseded by the current interaction. Setup and the Settings **Auto detect** button are the only detection entry points; saved agents are Codex, Claude Code, or Disabled. Conversion uses that agent with an explicit editable model (`gpt-6-luna` / `haiku`). Input converts after a 1-second pause, immediately on Cmd/Ctrl+Enter, blur, or Convert. There is no live toggle, automatic provider fallback, runtime probe, or additional 3-second throttle. See README for the shipped behavior.

# Diagram assist: image and text to Mermaid

Status: implemented in the application, October 8, 2026. The HTML playground below remains a simulation; the application now invokes real local agents.

Visual direction: an Apollo-style split workspace, with a full-height Input/Mermaid editor on the left and a pan-and-zoom preview filling the right. Agent choice and the persisted live-conversion option live in Settings, opened by the navbar cog. Attachments and review notes use collapsible trays.

Implementation notes: the selected dialog combines text and image input so image corrections can be supplied together. Its modal keeps the editor inert and verifies the original slash paragraph before inserting one undoable code block. Preferences are stored in the shared mdxserve config; Auto remembers the last successful provider for the current server process. Provider status checks inspect the CLI, not the remote token's validity. Conversion has a server-wide queue, deadlines, cancellation tombstones, bounded temporary uploads, strict worker validation and one repair attempt. The renderer must also succeed before insertion.

Verified locally: live Codex text and image conversions, Chrome text and pasted-image workflows, insertion/undo/save, unit and property tests. Claude's installed CLI returned an expired-token error, so successful live Claude generation remains unverified on this machine. Native Excalidraw drag payloads and Safari are not claimed as tested. The remainder records the original design and future refinements, including persisted provider history, identical-input caching and richer image-quality hints.

## Recommendation

Expose diagram creation **only while editing content and adding a new block**. Type `/` at an empty paragraph to open a block menu, then choose **Mermaid diagram** (`/mermaid`). Open a dialog anchored to that insertion point, with **Describe or paste** and **From image** tabs. Both inputs produce an editable draft, a rendered preview, and explicit notes about inferred relationships. Insert into the editor's undo history; the existing Save action commits the section. The dialog is the selected presentation; its only creation entry point is the active editor’s slash menu.

`index.html` is a local, dependency-free playground containing three switchable layouts. Open it directly, or serve this directory. Text, image selection, paste/drop, generation, source view, preferences, insertion, and undo are simulated. Results are fixed fixtures, not real Mermaid rendering or AI output. Changing a concept resets its composer. Preferences last only for this page session. `sample.svg` is a trusted illustration used by the demo; user SVG uploads are intentionally outside the proposed first release.

The updated playground starts in a simulated editing state: type `/mermaid`, select the command and explore the dialog. Rough-text edits trigger a simulated conversion after one second of inactivity; image selection starts immediately. Live conversion can be paused. The prior inline and side-panel concepts remain available for comparison, but all are entered from the editor’s slash menu. Results remain fixed samples; no real agent is invoked.

## Product behavior

### Entry and insertion

- Add a small custom Tiptap extension using `@tiptap/suggestion` with `char: "/"` and a context predicate requiring an editable, focused editor, a collapsed selection and an empty paragraph apart from the slash query. Suppress it inside code blocks, inline code and unsupported nested locations. The current `MdSectionEditor` does not register a slash-command extension.
- Show **Mermaid diagram** in the block insertion menu; match “diagram”, “mermaid”, “ER” and “image” search terms. Enter selects, arrow keys navigate and Escape dismisses. Handle these keys before the section editor's Escape handler so dismissing the menu does not discard the entire section edit.
- On selection, consume only the slash query and capture a ProseMirror bookmark, document identity, section identity and source version. Render the temporary composer as a dialog outside the document, rather than serializing it as document content. Map the bookmark through transactions. If the insertion target disappears or the editor closes, cancel the job and reject late results.
- No creation entry point in read mode, document headers, standalone exports or Mermaid error cards. Editing or repairing existing blocks is outside this feature's current scope.
- Scope paste/drop interception to the active new-diagram dialog. Ordinary editor image pastes/drops retain their existing behavior. There is no page-wide conversion drop target.
- Completion inserts one ordinary fenced `mermaid` block into the local draft, as a single undoable transaction. No placeholder or invalid source is written to disk. Reuse `DocsService.saveSection` version checks and atomic save. Identical handling for `.md` and `.mdx`.
- Standalone exports remain ordinary diagrams without agent controls. Disable conversion for LAN clients and when the local backend is unavailable.

### Images

1. Accept one PNG, JPEG or WebP from file drop, file picker or clipboard. Multiple files get an explanatory error rather than silently picking one. Validate actual bytes and decoded dimensions; proposed limits are 10 MiB input and 25 megapixels. Reject SVG, GIF, remote URLs and arbitrary local paths in v1.
2. A dedicated **Drop image to create diagram** zone clearly indicates conversion intent. This zone exists only inside the new-block composer opened from the active editor; ordinary document image drops do not invoke conversion. The first conversion explains which provider receives the input; subsequent diagram-target drops can start automatically.
3. Preview the image, preserve readable labels, normalize orientation, remove metadata, and resize only when needed for provider limits. Warn if fine labels may be unreadable. Browser normalization is an optimization; the server revalidates independently.
4. Auto-detect the diagram family, initially supporting ER, flowchart and sequence. Ask the user to clarify when the image is not a diagram or important relationships are illegible. ER output must expose inferred types, keys, nullability/cardinality and missing labels. Never equate syntactic validity with semantic accuracy.
5. Show source image beside preview. Allow retry with an optional correction such as “an order must have at least one line item.” Preserve the last valid draft while generating a replacement.
6. The default saved artifact is Mermaid only. Keep the original input for the composer session; discard temporary server data on completion/cancel/expiry. Persistent source-image attachment is a separate future option.

Excalidraw integration means accepting its exported/copied image, not assuming its canvas exposes a file through native drag events. Its official export utilities support PNG, SVG and scene JSON clipboard output. Test real Chrome/Safari payloads; when no supported image is present, offer “Copy as PNG or export an image.” Direct `.excalidraw` JSON support can come later and would preserve labels more reliably than vision. See [Excalidraw exports](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export).

### Text

- One input accepts natural language, rough Mermaid, or valid Mermaid. Do not force the user to classify it.
- First attempt local parse/render using the installed Mermaid version and mdxserve's supported diagram policy. If valid, preview immediately without an AI call; offer **Improve with AI** separately.
- If invalid or prose, keep the exact input and schedule agent conversion after **1 second of inactivity**. Label live conversion clearly alongside the selected provider. Offer **Pause live conversion** and **Convert now**. Empty input cancels; composition/IME input does not start requests until composition ends. Opening an empty dialog never runs an agent.
- Keep names, labels, direction, entities and relationships unless the user requests changes. Separate syntax repairs from semantic assumptions in the result.
- Let users inspect/edit generated Mermaid and revalidate locally. A hand edit invalidates the previous validation result; insertion is disabled until the current source renders successfully. Do not overwrite hand edits with a late response.
- Enter inserts a newline; Cmd/Ctrl+Enter converts immediately; Escape closes/cancels conversion while preserving the local draft where practical. Buttons provide the same actions. Use focus trapping for the dialog, return focus to the invocation point, and announce phase changes through an aria-live region.

### Lifecycle and recovery

`idle → preparing → queued → running → validating → ready | needs-review | failed | cancelled`

No invented percent progress. Show phase and elapsed time. Cancel terminates the process group and discards late events. A generation ID and input revision prevent obsolete responses from replacing newer input. Editing input marks the prior preview out of date. Keep previous good output accessible if a retry fails.

| Failure                            | User action                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| No supported agent                 | Show install/sign-in instructions and Recheck; retain input                          |
| Authentication expired             | Sign in externally, then retry; never launch an interactive login from conversion    |
| Unsupported CLI version            | Explain required capability/version; retain input                                    |
| Provider timeout/rate limit        | Retry or explicitly choose another provider                                          |
| Illegible image/ambiguous relation | Highlight the uncertain label or relation; request a correction                      |
| Invalid generated Mermaid          | One bounded repair attempt with parser feedback; then show editable source and error |
| File changed on disk               | Keep current draft; existing save conflict handling requires reload/reconciliation   |
| Input changed during run           | Ignore stale result; keep the newer input                                            |

## Agent preferences and selection

Use **mdxserve setup** as the initial configuration entry point and **Preferences → Diagrams** for later changes: Auto / Codex / Claude Code / Disabled. Store the preference on the server host in the user's mdxserve configuration, outside mounted docs; it describes executables and credentials on that host, not on a remote browser. Keep per-conversion override transient.

### Setup onboarding and disabling

Extend the existing `SetupService` workflow (currently skill installation and old MCP cleanup) with diagram capability detection and preference configuration. Detection discovers availability; it cannot infer a person's preference. Interactive setup should show the detected states and ask:

```text
AI Mermaid diagrams
  Codex        Installed · signed in
  Claude Code  Installed · sign-in required

Use for /mermaid:
  Auto (currently Codex)
  Codex
  Claude Code (sign in before use)
  Disabled
```

- Re-running setup preserves the saved choice, including Disabled, unless the user explicitly changes it. Do not run a paid model request merely to detect readiness.
- Proposed automation flag: `mdxserve setup --diagram-agent auto|codex|claude|disabled`. In non-TTY mode, never prompt: honor the explicit flag, otherwise preserve the existing setting; a new installation without a choice stays unconfigured and conversion remains off. Interactive setup may recommend Auto when at least one provider is eligible.
- Add a preferences entry so a user who skipped setup can configure the feature later. No implicit installation, browser login or interactive agent run. Missing agents do not break the existing skills/cleanup workflow. The current setup CLI returns early when neither cleanup agent is installed; restructure that control flow so diagram configuration still runs and can record Disabled.
- Use the shared persisted JSON configuration introduced on latest main. Add a namespaced `diagrams` object, e.g. `{ "agent": "auto" }`, leaving `roots` and unknown fields intact. Use one validated atomic patch mechanism with concurrency checks across roots and preferences; do not create independent whole-file writers that overwrite each other. Keep credentials and ephemeral auth status out of this file.
- Disabled hides the `/mermaid` suggestion, cancels active jobs and pending debounce timers, skips runtime agent probes, and rejects conversion/upload requests at the service boundary. Previously saved Mermaid diagrams continue to render normally. Re-enabling is explicit through setup or Preferences.
- Setup discovery does not replace runtime readiness checks: credentials, PATH and capabilities can change after setup. Probe before conversion when enabled, with the existing cache and bounded timeout.
- CLI interaction stays in the adapter. `SetupService`, the agent service and preferences service return typed outcomes and do not import terminal prompts. Both CLI setup and browser Preferences call the same domain services.

Tests: fresh setup, repeat setup, Disabled preservation, non-TTY without a flag, explicit override, zero/one/two agents, expired authentication, unrelated config field preservation, concurrent roots/config changes, and disabling while a conversion is in flight.

Probe both executables in parallel with a short timeout (proposed 3 seconds), collecting path, version, supported capabilities and authentication state. Do not read or expose credential files. Cache for 30 seconds; refresh on explicit Recheck and after authentication failures. A logged-in probe does not prove quota, model access or a successful vision request.

Auto resolution, in order:

1. Last successful provider if still installed, authenticated and capable of the input type.
2. The only eligible provider.
3. If both are eligible and there is no history, choose Codex as a **proposed deterministic tie-break**, visible as “Auto → Codex”; let the user change it immediately. This is a product default, not a quality claim.
4. If neither is eligible, block with actionable status. An unknown probe result is not signed-in readiness.

An explicit choice never silently falls back. Auto may re-resolve before submission; freeze the provider once a job starts. After submission, offer switching rather than automatically sending the same input to a second provider. Retain diagnostic distinctions: missing executable, unsupported version, signed out, ready, probe timed out, execution failed.

### Non-interactive adapters

Verified from local `--help` and current official documentation; exact minimum supported versions and hardened configurations remain a milestone-0 spike.

- **Codex:** `codex exec` is the non-interactive entry point, supports image attachment (`--image`), JSON events (`--json`), an output schema and ephemeral runs. `codex login status` returns an authentication status. Run from a private temporary working directory with no TTY, closed stdin after input, explicit read-only sandbox and approvals disabled. Do not use permission-bypass flags. Verify how to disable shell, MCP, hooks and user/project instructions while retaining existing authentication on supported versions. Read-only alone is not a tool-disable or file-read isolation guarantee. [Non-interactive mode](https://developers.openai.com/codex/noninteractive), [CLI reference](https://developers.openai.com/codex/cli/reference).
- **Claude Code:** use `claude -p`, structured JSON output and a JSON schema. `claude auth status` provides authentication information. Disable tools with `--tools ""`, disable MCP separately, disable skills, and use non-persistent sessions with permission mode `dontAsk`. Do not use `--bare` indiscriminately: the locally installed help says it skips OAuth/keychain authentication. Prove the supported image-content input envelope via stream JSON in the spike; a filename in a text prompt is not evidence the model saw the image. If direct image input cannot be verified without general file tools, mark image conversion unsupported for that version instead of pretending it works. [Programmatic execution](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference).
- Use argument arrays and stdin, never shell interpolation of user content. Filter environment/settings while preserving the chosen provider's documented authentication mechanism. No inherited project hooks, plugins or ambient MCP servers. Treat diagram text, image labels and model output as data. No repository read or write tools are needed.
- Runtime limits: proposed 90-second job deadline, one active conversion per server, queue depth 3, one syntax-repair retry, 64 KiB Mermaid output cap, bounded diagnostic buffers. Kill descendants on cancel/timeout/shutdown. Delete temp inputs in `finally`; scrub stale temp directories on startup. Avoid raw prompt/image/stdout logging. Ephemeral local execution does not promise zero retention by the provider.
- Require a compatibility fixture proving no TTY, no permission prompt, no unintended tool calls, correct image recognition and successful cancellation for each supported CLI version. These checks have **not** been run against live agents in this planning task.

## Architecture and contracts

Existing integration points: `client/MdSectionEditor.tsx` (Tiptap), `client/MdSection.tsx` (section lifecycle), `client/CodeBlock.tsx` and `client/Mermaid.tsx` (diagram UI), `src/docs/service.ts` (versioned saves), `src/http/start.ts` (process lifetime), and `src/api/trpc.ts` (context and loopback checks). The dependency is currently Mermaid 10.9.8; charts deliberately rejected by `client/mermaid-chart.ts` must remain rejected by generation too.

Proposed domains:

- `preferences/service.ts`: typed persistent preference and atomic update, injected storage path or store port; no provider credentials.
- `agents/service.ts`: discovery, readiness cache and selection policy with concrete injected probe/run ports. Per-process instance when it owns cached probe state.
- `diagrams/service.ts`: input checks, queue, jobs, generation/retry rules and result unions. Inject the agent service, validator and temporary-input store. Job state is an instance field initialized once in `startServer`; request authorization is a method argument, not constructor state.
- `agents/adapters/codex.ts`, `claude.ts`: CLI protocol encoding/decoding only. Pure prompt and result-normalization helpers remain plain functions. No service registry or generic dependency bag.
- `controller.ts` in each domain exports zod input/output schemas and described procedures; maps service result kinds to transport errors. Client imports only router types from `src/`.

**Explicit architecture amendment needed at implementation:** `src/setup/runner.ts` is currently the sole process-spawning file and its contract only returns exit code/stderr. Move the spawning mechanism into one shared infrastructure adapter (`src/infra/process-runner.ts`) and make the setup runner delegate to it. Add stdin, stdout/event streaming, cwd, environment, output caps and cancellation to that adapter's typed port. Update AGENTS.md and architecture tests with this agreed boundary. Do not import the setup domain into diagram services or scatter process spawning through services.

Suggested typed RPC surface (names provisional):

| RPC                        | Method | Input / result                                                                                    |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `getDiagramPreferences`    | GET    | Empty → default agent, last successful provider                                                   |
| `setDiagramPreferences`    | POST   | Agent enum → saved preference                                                                     |
| `probeDiagramAgents`       | POST   | Empty → bounded capability/auth summaries; no raw credentials                                     |
| `startDiagramConversion`   | POST   | Text or opaque uploaded-image ID, provider override, client request ID → job ID/resolved provider |
| `getDiagramConversion`     | GET    | Job ID → discriminated status/result union                                                        |
| `cancelDiagramConversion`  | POST   | Job ID → cancelled/already-terminal                                                               |
| `beginDiagramImageUpload`  | POST   | Media type, byte count → opaque upload ID                                                         |
| `appendDiagramImageChunk`  | POST   | Upload ID, sequence, base64 chunk → next sequence                                                 |
| `finishDiagramImageUpload` | POST   | Upload ID → validated opaque image ID                                                             |

All operations involving local agents, preferences or temporary inputs require same-machine access, including status reads. Retain same-origin mutation protection; revalidate `allowExecution` in the service. Bind jobs/uploads to an unguessable client session capability; do not treat knowledge of an arbitrary job ID as ownership. Verify loopback/Host protections against a hostile web page as part of implementation.

**Image transport is not a normal text field.** Current tRPC max body is 320 KiB. Preserve that cap; use sequential chunks capped at 128 KiB decoded (about 171 KiB base64 plus JSON), strict sequence checking, a server cumulative 10 MiB cap, upload-count cap and TTL. Finish checks magic bytes, dimensions and complete decoding before any provider call. Allocate server-owned temp names, never use client paths or filenames as filesystem locations. Abort/expiry cleans partial uploads. Prefer a dedicated upload RPC transport over raising the global cap; a scoped larger POST endpoint is an alternative if chunk complexity outweighs keeping the single tRPC adapter.

Result contract: `{ mermaid, diagramType, changes: string[], assumptions: string[], unresolved: string[] }`, bounded and validated with zod. Unresolved semantic ambiguities can produce `needs-review`; non-rendering syntax cannot produce `ready`. Prove Mermaid parse/render validation in a bounded DOM-capable rendering worker using the same installed version, strict security settings and chart policy as the browser. Existing React SSR validation alone is insufficient because client Mermaid effects do not execute during SSR. Client validates again before insertion. Strip/reject config directives, external links, HTML and click actions that exceed the diagram feature policy. Do not execute generated MDX/JavaScript or persist raw model output.

## Implementation sequence and acceptance

1. **Compatibility spike:** verify image inputs, auth probes, no-interaction execution, settings isolation and termination on both CLIs with synthetic diagrams; capture actual Excalidraw clipboard/drop payloads in Chrome/Safari; prove shared Mermaid validation in a worker. Resolve minimum CLI versions and process-runner amendment before product wiring.
2. **Setup, preferences and providers:** extend setup onboarding and non-interactive flags, implement Disabled gating, detection/selection, atomic preference persistence and typed RPC. Test all selection combinations, probe timeouts, no credentials in responses, and no fallback after submission.
3. **Text vertical slice:** edit-only `/mermaid` menu and new-block dialog, debounced live conversion, local valid-Mermaid fast path, non-interactive conversion job, bounded repair, preview/source review and Tiptap insertion. Test save conflicts, bookmark mapping and one-step undo with identical `.md`/`.mdx` fixtures.
4. **Image import:** chunked uploads, normalization, image agent payload, drag/paste/picker, ambiguity notes and cleanup. Test forged MIME, corrupt/oversized images, pixel limits, duplicate/out-of-order chunks and cancellation during upload/run.
5. **Polish and release:** keyboard/focus/responsive states, unavailable-agent setup, source diffs and retry corrections. Test dark mode, export behavior, remote access denial, prompt-injection fixtures and stale-result races. Run lint/typecheck/core tests; use claude-in-chrome for real browser acceptance and screenshots when available.

Tests mirror domain modules under `tests/preferences`, `tests/agents`, `tests/diagrams` with functional and property tests. Properties: explicit provider never changes; selection is deterministic; output cannot exceed bounds; terminal jobs cannot resurrect; stale input cannot be overwritten; partial uploads cannot reach agents; cancellation never saves a document; arbitrary input cannot introduce command arguments. Fake runner/validator ports cover most tests; keep paid live-agent smoke runs opt-in.

Definition of done: a copied/exported ER image and rough Mermaid text each become a reviewed, editable, valid Mermaid fence; preferences select the correct eligible agent; no CLI interaction blocks; no source file changes before Save; failures preserve input; all supported file extensions behave identically.

## Decisions to make together

- Resolved: creation is limited to adding a new block in the active editor. Selected presentation: `/mermaid` → dialog → image drop or live rough-text conversion.
- Is ER the main target, with flowchart/sequence as secondary types, or should v1 deliberately be ER-only?
- Is Codex an acceptable initial tie-break when both agents are ready? Auto retains the last successful choice after that.
- Should original images ever be saved alongside the Mermaid, or stay temporary by default?

These are product choices, not implementation blockers for exploring the mockups. The proposal above supplies provisional defaults.

## Prototype verification

Checked in Chrome through the available Codex browser tool: all three concept layouts, text generation, Mermaid source toggle, draft insertion and undo, sample-image conversion, and changing the default agent. Captured `preview.png`. JavaScript syntax and targeted Prettier checks passed. The mockup's real file-picker, OS clipboard and cross-app drag payloads still need manual coverage; no actual AI, auth, upload API, or Mermaid renderer was exercised.

`claude-in-chrome` was unavailable, so this is a documented browser-tool substitution, not completion of that repository-specific release/PR requirement. `yarn dev` could not start: the shell has Yarn 1.22.22, the project requests Yarn 4.18.0, Corepack is absent, and this checkout has no installed dependencies. The standalone HTML was instead served on localhost:43871. No application source, dependencies, commits or PRs were changed.

## Tiptap slash-command feasibility

Tiptap supports slash-command menus through its [Suggestion utility](https://tiptap.dev/docs/editor/api/utilities/suggestion), including a configurable trigger character, context eligibility and command callbacks. Its [slash-command example](https://tiptap.dev/docs/examples/experiments/slash-commands) uses that utility. This needs an extension and menu UI in our editor; it is not enabled by the current StarterKit configuration. Pin the added package to the project's Tiptap version and implement the small menu directly rather than depending on an experimental example as a maintained extension. No Tiptap-hosted AI service is required.

Additional acceptance checks: no creation affordance outside edit mode; typing a slash in code/URLs does not open the menu; menu Escape does not exit section editing; selection removes only the slash query; cancelling preserves surrounding content; final insertion is a single undo step; closing the editor cancels pending conversion; placeholder UI never enters saved Markdown.

## Live conversion scheduling

The client keeps separate input revision, last successful result revision and active request ID. Each edit immediately marks the preview out of date and disables Insert, while leaving the previous good diagram visible. Only a result matching the current input, image and provider may become insertable. A new generation cancels the previous process; server-side serialization must wait for that process to terminate before starting its replacement. Keep only the latest pending input, not a queue of intermediate keystrokes. Switching modes/provider, closing the dialog or leaving edit mode cancels both debounce and active conversion. Requests for identical input/provider can reuse a successful result within the dialog session.

Rate-limit/auth failures pause automatic retries and show an explicit retry action, avoiding repeated paid failures while the user types. Use a modest server minimum launch interval (proposed 3 seconds) in addition to the debounce and single-active-process limit. One syntax-repair attempt is still the maximum per completed generation. No partial model response is rendered as executable MDX; validate the final Mermaid before preview/insertion. Valid Mermaid skips the agent and refreshes locally. The dialog should explain that live conversion sends each settled revision to the selected provider and consumes account usage.

The updated HTML demonstrates scheduling with a one-second debounce, cancellation of pending timers, stale-preview state, image-triggered conversion and edit-mode gating. Agent cancellation and actual text-to-Mermaid conversion remain planned backend work.

## Rebase baseline

This worktree was rebased onto freshly fetched `origin/main` at `a849c77` on October 8, 2026. Design files were preserved. The plan now incorporates main’s shared persisted roots config (`src/roots/config.ts`), whose schema preserves unknown fields. Runtime implementation remains outside the current mockup changes.
