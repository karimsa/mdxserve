v0.5.1

Bug fixes

- Restore section editing in installed packages ([#25](https://github.com/karimsa/mdxserve/pull/25)).
- Promote site releases using project-scoped Vercel credentials ([#21](https://github.com/karimsa/mdxserve/pull/21)).
- Retain production and the newest other site image using short-lived registry credentials, with safe authentication diagnostics ([#26](https://github.com/karimsa/mdxserve/pull/26), [#27](https://github.com/karimsa/mdxserve/pull/27), [#28](https://github.com/karimsa/mdxserve/pull/28)).

v0.5.0

What's new

- Add slash commands for document blocks and built-in components ([#16](https://github.com/karimsa/mdxserve/pull/16))

- feat: Add frontmatter page metadata and Open Graph tags ([#15](https://github.com/karimsa/mdxserve/pull/15))

Bug fixes

- Prevent hosted sites from connecting to localhost ([#14](https://github.com/karimsa/mdxserve/pull/14))

v0.4.0

What's new

- Persist roots in a watched JSON config ([#2](https://github.com/karimsa/mdxserve/pull/2))

- Ignore leading YAML frontmatter in Markdown documents ([#6](https://github.com/karimsa/mdxserve/pull/6))

- Add interactive typed tables and Markdown table cards ([#8](https://github.com/karimsa/mdxserve/pull/8))

- Add AI-assisted Mermaid diagram authoring ([#7](https://github.com/karimsa/mdxserve/pull/7))

- Add shared dialogs and content layout settings ([#9](https://github.com/karimsa/mdxserve/pull/9))

- Add full and restricted permission modes ([#10](https://github.com/karimsa/mdxserve/pull/10))

- Add layout settings to standalone HTML exports ([#11](https://github.com/karimsa/mdxserve/pull/11))

- Add interactive MDX site and release-controlled Vercel deployment ([#12](https://github.com/karimsa/mdxserve/pull/12))

Bug fixes

- Fix dependency warnings in npm installs ([#3](https://github.com/karimsa/mdxserve/pull/3))

v0.3.0

What's new

- Add background CLI update notifications

Bug fixes

v0.2.0

What's new

Bug fixes

v0.1.0

What's new

- Add builtin component library, JSON registry, and components CLI

- Add pan/zoom to mermaid diagrams with custom controls

- Add framer-motion enter/exit transitions with client-side navigation

- Add Button, Tooltip, Tabs, and Badge builtin components

- Add jotai for shared state, resizable sidebar, absolute-path listing breadcrumb (#10)

- Add teal-550 as the fill under white text (#11)

- Add a resizable full-screen view for mermaid diagrams and charts (#28)

- Add `mdxserve export`: one doc into one self-contained HTML file (#34)

- Add an Export menu to the viewer's top bar (#35)

- Add a <Screenshot> builtin with an expand view, and validate_doc hints (#40)

Bug fixes

- Fix npm CLI bin declaration
