import { CodeBlock, Tabs } from "../components/content";
import { BarChart, Flowchart } from "../components/figures";
import { Link } from "../router";

const diagramSource = `flowchart LR
  Folder[A folder of Markdown] --> Page[A page to read]
  Page --> Idea[Your next idea]`;

const chartSource = `<Chart
	id="notes-chart"
	filename="sample-notes.json"
	type="bar"
	data={[
		{ label: "Mon", notes: 4 },
		{ label: "Tue", notes: 7 },
		{ label: "Wed", notes: 5 },
		{ label: "Thu", notes: 9 },
		{ label: "Fri", notes: 6 },
	]}
	series={["notes"]}
	yLabel="Notes read"
/>`;

const tabsSource = `<Tabs id="install-tabs">
	<Tab label="macOS">\`brew install foo\`</Tab>
	<Tab label="Linux">\`apt install foo\`</Tab>
</Tabs>`;

const sampleNotes = [
	{ label: "Mon", values: { notes: 4 } },
	{ label: "Tue", values: { notes: 7 } },
	{ label: "Wed", values: { notes: 5 } },
	{ label: "Thu", values: { notes: 9 } },
	{ label: "Fri", values: { notes: 6 } },
];

export function Home() {
	return (
		<>
			<section className="hero">
				<p className="eyebrow">Markdown and MDX reader</p>
				<h1 className="hero-title">mdxserve</h1>
				<p className="hero-lede">A folder of Markdown, ready to read in your browser.</p>
				<p className="hero-body">
					mdxserve turns your notes, project plans, and docs into pages you can browse and search.
					Code gets highlighting, diagrams get room to breathe, and builtin components such as
					callouts, tabs, and charts sit alongside the prose.
				</p>
				<div className="card-grid">
					<Link to="/tour" className="card">
						<span className="card-title">Take the interactive tour</span>
						<span className="card-description">
							Try tabs, charts, diagrams, and code diffs in a working document.
						</span>
					</Link>
					<Link to="/get-started" className="card">
						<span className="card-title">Open your own folder</span>
						<span className="card-description">
							Run one command and start reading the Markdown you already have.
						</span>
					</Link>
				</div>
				<img
					className="hero-shot"
					src="/reader-light.jpg"
					alt="Markdown displayed in the mdxserve reader"
					width={1530}
					height={784}
				/>
			</section>

			<article className="prose">
				<h2 id="try-a-little-mdx">Try a little MDX</h2>
				<p>A document can explain something and let you try it. Switch between these examples.</p>
				<Tabs
					items={[
						{
							label: "A diagram",
							content: (
								<>
									<Flowchart
										width={640}
										height={76}
										caption="A Mermaid flowchart, as the reader draws it"
										nodes={[
											{ id: "folder", label: "A folder of Markdown", x: 16, y: 16 },
											{ id: "page", label: "A page to read", x: 236, y: 16 },
											{ id: "idea", label: "Your next idea", x: 456, y: 16 },
										]}
										edges={[
											["folder", "page"],
											["page", "idea"],
										]}
									/>
									<p>
										In the reader, the diagram's controls let you zoom, expand it, or read its
										Mermaid source. The whole drawing comes from a code fence in the file:
									</p>
									<CodeBlock language="mermaid" code={diagramSource} />
								</>
							),
						},
						{
							label: "A chart",
							content: (
								<>
									<BarChart
										data={sampleNotes}
										series={["notes"]}
										yLabel="Notes read"
										caption="Sample numbers for a week of reading"
									/>
									<p>
										In the reader, you can hover over a bar to see its value. These are sample
										numbers, passed straight to the builtin <code>Chart</code> component.
									</p>
									<CodeBlock language="mdx" code={chartSource} />
								</>
							),
						},
						{
							label: "Tabs",
							content: (
								<>
									<p>
										The <code>Tabs</code> component shows one variant of the content at a time, such
										as install steps for each operating system. The selected tab is kept under the
										component's <code>id</code>, so it stays selected when the document changes.
									</p>
									<CodeBlock language="mdx" code={tabsSource} />
								</>
							),
						},
					]}
				/>

				<h2 id="bring-your-own-files">Bring your own files</h2>
				<p>With Node.js 22.14 or newer, point mdxserve at a folder:</p>
				<CodeBlock language="bash" code="npx @karimsa/mdxserve serve -w ./docs" />
				<p>
					Open the URL it prints. On your own machine, you can edit sections and save them back to
					disk, and watch changes from your text editor appear.
				</p>
				<p>
					<Link to="/get-started">Get started with mdxserve</Link>, or browse the{" "}
					<a href="https://github.com/karimsa/mdxserve">source on GitHub</a>. Open source under the
					MIT license.
				</p>
			</article>
		</>
	);
}
