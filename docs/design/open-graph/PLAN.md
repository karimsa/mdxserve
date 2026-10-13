# Open Graph metadata in MDX

Status: Frontmatter selected for implementation. The native-tag sections below record the alternatives considered. Frontmatter is the supported path for metadata in initial HTML, browser navigation, and exports.

Allow documents to declare their own page title, description, canonical URL, and ordered Open Graph tags using leading YAML frontmatter. Use `./site` as the first consumer. The feature must work identically in `.md` and `.mdx`, update during browser navigation, and put sharing metadata in the initial HTML response.

## Implementation decisions

Use the frontmatter schema below, with explicit Open Graph values and no automatic defaults. Parse and validate metadata once per compilation or source read, then share the normalized shape between initial HTML, the browser, and export. Metadata extraction executes no document JavaScript.

Use the public homepage `/` as the site's canonical identity. Other site pages use their deployed `/srv/docs/` document URLs. Invalid recognized metadata produces validation warnings and discards the document's head metadata, preserving body rendering and the filename title fallback.

A single browser head owner follows the committed route, clears outgoing metadata, and updates on file changes. It adopts initial HTML metadata without duplicating tags. Native JSX metadata is not integrated with frontmatter precedence in this version.

## Native tag alternative

Write tags directly in the document, alongside its content:

```mdx
<title>mdxserve</title>
<meta name="description" content="A folder of Markdown, ready to read in your browser." />
<meta property="og:title" content="mdxserve" />
<meta property="og:description" content="A folder of Markdown, ready to read in your browser." />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://mdxserve.karim.build/" />
<meta
	property="og:image"
	content="https://mdxserve.karim.build/srv/docs/examples/assets/reader-light.jpg"
/>
<meta property="og:image:alt" content="Markdown displayed in the mdxserve reader" />
<link rel="canonical" href="https://mdxserve.karim.build/" />

# mdxserve

A folder of Markdown, ready to read in your browser.
```

React 19 moves document metadata into `<head>` even when the tags are rendered inside a page component. mdxserve already uses React 19, so this syntax needs no Helmet dependency. See the React references for [meta](https://react.dev/reference/react-dom/components/meta), [title](https://react.dev/reference/react-dom/components/title), and [link](https://react.dev/reference/react-dom/components/link).

The [Open Graph protocol](https://ogp.me/) defines title, type, image, and URL as its basic properties. Repeated tags can represent multiple images or locales, and their order matters. The metadata model must preserve that order rather than flattening properties into a map.

The browser can also render tags from expressions or imported components:

```mdx
export const pageTitle = "Getting started with mdxserve";

<title>{pageTitle}</title>
<meta property="og:title" content={pageTitle} />
```

Whether those computed values also reach crawlers depends on the delivery strategy below. We should decide that guarantee before documenting the feature.

## Frontmatter authoring

Frontmatter would declare metadata as data at the start of the file. Frontmatter is the selected authoring direction. It offers a way to deliver static metadata to crawlers without parsing JSX or rendering the document.

```mdx
---
title: mdxserve
description: A folder of Markdown, ready to read in your browser.
canonical: https://mdxserve.karim.build/
openGraph:
  - property: og:title
    content: mdxserve
  - property: og:description
    content: A folder of Markdown, ready to read in your browser.
  - property: og:type
    content: website
  - property: og:url
    content: https://mdxserve.karim.build/
  - property: og:image
    content: https://mdxserve.karim.build/srv/docs/examples/assets/reader-light.jpg
  - property: og:image:alt
    content: Markdown displayed in the mdxserve reader
---

# mdxserve

A folder of Markdown, ready to read in your browser.
```

### Schema and mapping

`title` would produce the document title, `description` a description meta tag, and `canonical` a canonical link. `openGraph` would be an ordered list of property and content pairs. The example repeats the title and description explicitly so the ordinary page metadata and sharing metadata can differ. Automatic fallbacks from those fields to Open Graph values could be a later convenience, but should be an explicit schema decision.

An ordered list preserves repeated properties and the grouping of image attributes after their image. A short map such as `openGraph: { title: ..., image: ... }` is easier to write for one image, but cannot represent repeated keys. Supporting both forms would require normalization rules and more documentation. Start with one form if we choose frontmatter.

Validate recognized fields with a shared schema. Require strings for titles, descriptions, URLs, and property names. Content could accept strings and finite numbers, converting numbers to strings for properties such as image dimensions. Require `og:` property names with valid segments. Diagnose malformed recognized fields and duplicate YAML keys, while leaving unrelated frontmatter fields available for other uses. Metadata validation and HTML escaping remain separate steps.

### Parsing and delivery

The existing frontmatter support recognizes the leading YAML block and hides it from the visible body. `src/docs/frontmatter.ts` already provides that boundary for body extraction. This alternative would add YAML value parsing and metadata validation using the same boundary in both `.md` and `.mdx`. Parse only the leading block, preserve body line numbers, and bound input size and YAML alias handling. JavaScript expressions and custom executable YAML tags would not be evaluated.

A pure helper in the docs module would normalize the recognized fields into the same structured head model used by the HTML serializer. The HTTP adapter would obtain source through the docs service, then pass normalized metadata into the shell. Export would reuse the helper with the source it already reads. Neither path needs to import or execute the document to obtain its metadata.

For browser navigation, the MDX compilation step could export the normalized metadata under a reserved internal name. The router would read it with the document module and pass it to one head owner for the committed route. That owner would update the title, description, canonical link, and Open Graph tags, remove the previous page's declarations, and coordinate the handoff from the initial HTML. File updates would refresh the exported metadata with the document module. Exported pages would use the same ownership rules when they mount.

Frontmatter must remain intact when editing body sections. A metadata editor is outside the initial scope, so authors would edit the YAML in their source files. Validation should report errors at the original YAML locations. We still need to choose whether invalid metadata blocks publication or merely produces diagnostics and a filename fallback during local serving.

### Comparison with native tags

| Concern                           | Frontmatter                                                      | Native React tags                                                                       |
| --------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Initial crawler response          | Parse and serialize declared data directly.                      | Extract literal tags or render the document.                                            |
| Expressions and shared components | Static data only unless a separate templating system is added.   | React can compose metadata, subject to the chosen server delivery strategy.             |
| Authoring surface                 | A schema maintained by mdxserve.                                 | Familiar HTML and React syntax.                                                         |
| Repeated Open Graph values        | An ordered list preserves repetitions and grouping.              | Repeated JSX tags preserve declarations naturally.                                      |
| Server execution                  | Metadata extraction never executes document code.                | Literal extraction avoids execution; rendering requires an execution policy.            |
| Browser lifecycle                 | mdxserve must connect parsed metadata to navigation and updates. | React manages mounted tags, with shell and transition ownership still to resolve.       |
| Extension to other head features  | Requires additions to the schema.                                | Additional native tags are possible, with their server guarantees specified separately. |

Frontmatter is a candidate if a small static metadata contract matters more than React composition. Native tags are a candidate if metadata should behave like the rest of the MDX component tree. Both approaches need the same public URL rules, escaping, navigation cleanup, and export behavior.

If we support both, precedence must be explicit. One possible rule is to use frontmatter as defaults and let JSX override singleton values. Repeated Open Graph properties would still need a separate replacement or append rule that preserves image groups. With static JSX extraction, computed overrides could also make the browser disagree with crawler HTML. Supporting both should therefore be a deliberate scope choice rather than an implicit fallback.

## Rendering before implementation

Document requests pass through `src/http/server.ts`, which sends an HTML shell with an empty React root. `src/http/shell.ts` and `src/http/html.ts` choose the filename as the initial page title. The browser imports the compiled document afterward.

`client/router.ts` sets `document.title` during initial load and navigation. Native page titles will need to cooperate with that fallback. The rendering path must also remove metadata from the previous document when navigation completes.

There is an existing server renderer in `src/rendering/render.ts`, backed by a worker and `client/ssr-entry.tsx`. It currently checks whether a document renders successfully and discards the resulting markup. Restricted servers do not create that renderer. Remote validation requests also cannot trigger document execution on the server.

HTML export bundles the document for browser rendering. `src/export/service.ts` already reads the source, and `src/export/html.ts` assembles the initial HTML. Export needs the same metadata guarantee as served pages.

The deployed site redirects `/` to `/srv/docs/README.mdx`. Local serving uses a different filesystem path. Public metadata URLs therefore cannot be derived directly from an absolute source path.

## Delivering metadata to crawlers

Putting tags into the browser DOM is only part of the feature. The first HTML response must contain them so a preview client can read them without running JavaScript.

| Approach                         | Expressions and imported components                   | When document JavaScript runs on the server                   | Main cost                                            |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| Extract literal tags from source | Only literal declarations reach the initial response  | Never for metadata extraction                                 | A restricted authoring contract for crawler metadata |
| Render on HTTP requests          | Can include metadata produced during server rendering | On requests, subject to explicit execution policy and caching | Runtime execution, latency, errors, and invalidation |
| Prerender during publication     | Can include metadata produced during the build        | During the trusted build                                      | A publication step and a generated route manifest    |

### Extract literal tags

Parse the document with the same syntax rules as rendering and collect unconditional metadata declarations at the document root. Ignore code fences, YAML frontmatter, examples, and tags inside component bodies or conditional expressions. Root fragments could be supported if their contents are also unconditional.

Recognize literal `<title>`, `<meta name content>`, `<meta property content>`, and `<link rel="canonical" href>` declarations. Leave `itemProp` metadata in the body. Do not treat scripts, styles, resource links, or arbitrary HTML as sharing metadata.

This approach serves the initial `./site` example without executing its imports. It also works on restricted servers and can share its extraction helper with export. It cannot promise that a reusable metadata component or a value such as `content={pageTitle}` reaches the initial response. Such declarations need a validation warning so browser behavior does not hide the crawler limitation.

Extraction should produce structured data and escape it when serializing HTML. Do not copy raw source into `<head>` or attempt to find tags with regular expressions. A document without metadata keeps the current filename fallback. Parse failures should preserve the existing document error experience rather than break shell delivery.

### Render on requests

Extend the existing rendering port to return structured head metadata as well as render success. Render through the same component map as the browser. This supports expressions and imported metadata components that can run during server rendering. Metadata produced only in effects or from browser APIs still cannot appear in the first response.

Server execution must be an explicit server or publication capability. A remote GET should not gain the ability to execute arbitrary document JavaScript merely because it requests a preview. Enabling that capability for our trusted site would be a deliberate deployment choice. Local and restricted modes need defined behavior when it is disabled.

The design would need bounded rendering, concurrent-request deduplication, cache invalidation for imported dependencies, and a response policy for failures. A worker timeout bounds execution but does not remove filesystem or process privileges. Rendering only to collect the head also still executes the document body and imports.

### Prerender during publication

Render trusted documents during the site build and save their metadata in a manifest keyed by public route. HTTP requests read that manifest. This supports shared components without executing document code on public requests.

The deployment must generate the manifest from the same source revision as the served pages. Export could use the same rendering operation. Ordinary folders served without a publication step would still need a documented behavior, such as browser metadata only or static extraction.

This is a larger change than extracting tags, but fits an immutable published site. It also requires resolving the relationship between source paths, public routes, canonical URLs, and preview deployment domains.

## Proposed scope

Use frontmatter as the metadata API. The docs service reads and validates leading YAML for the HTTP shell, the compiler exports the same normalized fields for the browser, and export uses the same parser. Metadata extraction requires no document rendering or publication manifest. The native-tag delivery alternatives above remain possible future directions.

The native-tag proposal does not require a YAML metadata schema or a Helmet wrapper. The frontmatter alternative above would introduce a schema if selected. Helmet can be reconsidered if we need its extra APIs. The current [react-helmet-async documentation](https://github.com/staylor/react-helmet-async#react-19) explains that its React 19 path delegates tag placement to React itself.

Support title, ordinary description metadata, Open Graph properties, and canonical links. Twitter metadata can use the same native `<meta name content>` syntax. Image generation, inherited site defaults, URL rewriting, and full page SSR are separate decisions.

## Behavior to specify

| Area                           | Proposed behavior                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing metadata               | Preserve the filename title fallback and omit undeclared sharing tags.                                                                                      |
| Duplicate singleton tags       | Diagnose duplicate titles, descriptions, or canonical links. Choose a deterministic fallback if the document is still served.                               |
| Repeated Open Graph properties | Preserve repeated tags and source order, including image properties grouped after their image.                                                              |
| Browser navigation             | Remove the previous page's metadata and apply the new page's tags. Listing and error routes restore their fallback title.                                   |
| File updates                   | Update the head after the document changes, including removal of declarations.                                                                              |
| Metadata during transitions    | Apply metadata for the committed destination, even if outgoing content remains mounted for an animation.                                                    |
| URLs                           | Require explicit absolute public URLs for sharing images and canonical identity initially. Do not infer them from Host headers or filesystem paths.         |
| Export                         | Include supported metadata in the file's initial head and avoid duplicate tags when React mounts. Canonical and image URLs remain the author's public URLs. |
| Editor                         | Keep head declarations out of ordinary visible prose editing. Preserve their source when saving neighboring sections.                                       |

Native React hoisting does not by itself settle duplicate tags already emitted by the shell. Initial response tags and mounted React tags need a defined ownership handoff. Titles also need a single fallback owner rather than competing writes from the router and document.

These behaviors need browser verification, especially navigation transitions, title restoration, and the handoff from initial HTML to React. A static HTML assertion cannot establish them.

## Testing with the site

Start with `site/README.mdx`, `site/get-started.mdx`, and `site/tour.mdx`. Give each a distinct title, description, and canonical URL. Use the existing reader screenshot as the first sharing image. Decide whether the homepage's canonical identity should be `/` or its redirected document URL, and use the same identity in `og:url`.

Verify the initial response with JavaScript disabled or an HTTP client sending `Accept: text/html`. Follow the production homepage redirect and check both the homepage and direct document URLs. Fetch the image URL and confirm that it returns a public image with the expected content type.

In a browser, open the homepage, navigate to the tour and getting-started page, go back, and open a directory listing. Inspect the head after each navigation for stale tags and duplicate titles. Edit or remove a declaration locally and verify the update. Export one page and repeat the initial-head and browser checks on the resulting file.

Automated coverage should exercise the guarantees we choose:

- Equivalent metadata behavior for `.md` and `.mdx`.
- Tags in the initial HTTP response and exported HTML.
- Correct escaping of quotes, ampersands, and markup-like values.
- Repeated Open Graph tags retaining their order.
- No metadata extracted from code examples or inactive component branches.
- A clear outcome for expressions and imported metadata components.
- Existing root containment and restricted-server execution rules.
- Browser title restoration, metadata cleanup, and updates without duplicate tags.

Property tests should cover serialization escaping and preservation of ordered metadata. If we introduce a service, test its interface guarantees and core behavior under the repository's service conventions.

## Deferred decisions

Automatic Open Graph defaults, reusable metadata components, and inherited site settings are outside the initial scope. Frontmatter and native JSX head declarations have no combined precedence contract. Authors should use frontmatter alone for the fields managed by this feature.

Invalid metadata produces warnings and an empty metadata result. The document body can still render, and the filename supplies the fallback title. The site's homepage canonical URL is `/`, with other pages using their public document URLs.

## Tasks

- [x] Choose frontmatter as the authoring direction.
- [x] Document the current rendering paths and delivery alternatives.
- [x] Outline frontmatter syntax, parsing, delivery, and tradeoffs.
- [x] Decide the crawler metadata guarantee and execution policy.
- [x] Specify head ownership, duplicate handling, and canonical URLs.
- [x] Implement the agreed approach with Markdown and MDX parity.
- [x] Add metadata to the three site pages.
- [x] Verify HTTP responses, browser navigation, updates, and exports.

## Changelog

- October 10, 2026: Drafted the design around native React metadata, with crawler delivery left open for discussion.
- October 10, 2026: Added the frontmatter alternative, including an ordered Open Graph schema, shared parsing, browser integration, and coexistence decisions.
- October 10, 2026: Selected frontmatter with static extraction, explicit Open Graph values, validation warnings, and a single browser head owner.
- October 10, 2026: Implemented frontmatter metadata and verified site responses, browser navigation and updates, and a real HTML export.
