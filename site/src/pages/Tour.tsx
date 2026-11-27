import { Badge, Callout, CodeBlock, Diff, Kbd, Tabs } from "../components/content";
import { BarChart, Flowchart } from "../components/figures";
import { Link } from "../router";

const calloutSource = `<Callout tone="note" title="A good place to leave some context">
	Put the decision next to the diagram.
</Callout>

Status: <Badge tone="ok" dot>Ready to read</Badge>`;

const tabsSource = `<Tabs id="install-tabs">
	<Tab label="macOS">\`brew install foo\`</Tab>
	<Tab label="Linux">\`apt install foo\`</Tab>
</Tabs>`;

const diagramSource = `flowchart LR
  Idea[An idea] --> File[A Markdown file]
  File --> Reader[A page to read]
  File --> Chart[A chart to explore]
  File --> Component[A component to try]`;

const codeSample = `const idea = "A folder of notes";
const nextStep = "Open it in the browser";
console.log(idea, nextStep);`;

const sampleWeek = [
	{ label: "Mon", values: { notes: 4, plans: 2 } },
	{ label: "Tue", values: { notes: 7, plans: 3 } },
	{ label: "Wed", values: { notes: 5, plans: 6 } },
	{ label: "Thu", values: { notes: 9, plans: 4 } },
	{ label: "Fri", values: { notes: 6, plans: 5 } },
];

export function Tour() {
	return (
		<article className="prose">
			<p className="eyebrow">Tour</p>
			<h1>Take it for a spin</h1>
			<p className="lede">
				Here is what a document can hold: tabs, callouts, diagrams, charts, and code diffs. You can
				explore these examples without installing anything.
			</p>

			<h2 id="start-with-a-little-structure">Start with a little structure</h2>
			<p>
				Components are available right inside a <code>.md</code> or <code>.mdx</code> file. These
				tabs, callouts, and badges use mdxserve's builtins.
			</p>
			<Tabs
				items={[
					{
						label: "A project note",
						content: (
							<>
								<Callout tone="note" title="A good place to leave some context">
									Put the decision next to the diagram. Explain the surprising number beside the
									chart. Keep the useful bits together.
								</Callout>
								<p>
									Status: <Badge tone="ok">Ready to read</Badge>
								</p>
							</>
						),
					},
					{
						label: "The MDX behind it",
						content: <CodeBlock language="mdx" code={calloutSource} />,
					},
				]}
			/>
			<p>
				The builtin components also include tooltips, cards, keyboard shortcuts, file trees,
				screenshots, and code diffs.
			</p>

			<h2 id="give-an-explanation-a-shape">Give an explanation a shape</h2>
			<p>
				A Mermaid code fence becomes a diagram. In the reader, its controls let you zoom, open it
				full-screen, or look at the source.
			</p>
			<Flowchart
				width={640}
				height={196}
				caption="The flowchart from the code fence below, as the reader draws it"
				nodes={[
					{ id: "idea", label: "An idea", x: 16, y: 76 },
					{ id: "file", label: "A Markdown file", x: 236, y: 76 },
					{ id: "reader", label: "A page to read", x: 456, y: 16 },
					{ id: "chart", label: "A chart to explore", x: 456, y: 76 },
					{ id: "component", label: "A component to try", x: 456, y: 136 },
				]}
				edges={[
					["idea", "file"],
					["file", "reader"],
					["file", "chart"],
					["file", "component"],
				]}
			/>
			<CodeBlock language="mermaid" code={diagramSource} />
			<p>
				Mermaid can draw more than flowcharts, including entity relationships. On your own machine,
				the diagram editor can help turn rough text or an image into Mermaid with a configured Codex
				or Claude Code provider.
			</p>

			<h2 id="put-the-numbers-in-the-document">Put the numbers in the document</h2>
			<p>
				In the reader, you can hover over a bar to inspect it. These are invented numbers for the
				demo, so please do not take them as a benchmark.
			</p>
			<BarChart
				data={sampleWeek}
				series={["notes", "plans"]}
				yLabel="Documents read"
				xLabel="Sample week"
				caption="A builtin Chart with two series"
			/>
			<p>
				The <code>Chart</code> component also draws line and area charts, horizontal bars,
				histograms, and sparklines. <code>DataTable</code> gives you typed columns, sorting, and
				filters.
			</p>

			<h2 id="show-what-changed">Show what changed</h2>
			<Diff
				title="docs/hello.md"
				before={"# Project notes\n\nRead this in your editor."}
				after={"# Project notes\n\nRead this in your browser.\n\nAdd a diagram when it helps."}
			/>
			<p>Code fences also support a filename, line numbers, and highlighted lines:</p>
			<CodeBlock
				title="a-small-idea.ts"
				language="ts"
				lineNumbers
				highlight={[2]}
				code={codeSample}
			/>

			<h2 id="let-the-reader-choose">Let the reader choose</h2>
			<p>
				<code>Tabs</code> shows one variant of the content at a time, such as instructions for each
				operating system. A document switches content with <code>Tabs</code>, not with code, so it
				stays plain text that an agent can write and check.
			</p>
			<p>
				A stateful component needs an <code>id</code> that is unique in the document. The reader
				uses it to remember which tab is selected.
			</p>
			<CodeBlock language="mdx" code={tabsSource} />

			<h2 id="explore-the-reader-too">Explore the reader, too</h2>
			<p>
				In the reader, try the theme switch in the top bar. Use <Kbd>⌘</Kbd> <Kbd>K</Kbd> on macOS
				or <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> elsewhere to search the served documents. The sidebar
				follows the folder structure, and the table of contents follows the page's headings.
			</p>
			<p>
				When you <Link to="/get-started">run mdxserve locally</Link>, you can also edit document
				sections, save them back to disk, and see changes from your text editor appear in the
				browser.
			</p>
			<p>
				<Link to="/get-started">Get started →</Link>
			</p>
		</article>
	);
}
