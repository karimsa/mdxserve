import { Callout, CodeBlock, Kbd } from "../components/content";
import { Link } from "../router";

const firstIdea = `# A small idea

Write the explanation here.

<Callout tone="note" title="Something to remember">
	Keep the decision next to the reasons behind it.
</Callout>`;

export function GetStarted() {
	return (
		<article className="prose">
			<p className="eyebrow">Get started</p>
			<h1>Make yourself at home</h1>
			<p className="lede">
				Point mdxserve at a folder of Markdown or MDX. It gives you a browser for the files, with
				readable pages, search, and interactive components.
			</p>

			<h2 id="open-your-first-folder">Open your first folder</h2>
			<p>
				You need <strong>Node.js 22.14 or newer</strong>. From a terminal, run this with the path to
				your docs:
			</p>
			<CodeBlock language="bash" code="npx @karimsa/mdxserve serve -w ./docs" />
			<p>
				Open the URL printed in the terminal. The default is <code>http://127.0.0.1:4040</code>. If
				that port is busy, mdxserve picks a free one.
			</p>
			<p>For a command you can use every day, install it globally:</p>
			<CodeBlock
				language="bash"
				code={`npm install -g @karimsa/mdxserve
mdxserve serve -w ~/notes`}
			/>

			<h2 id="start-with-a-file-you-already-have">Start with a file you already have</h2>
			<p>
				A README, a project plan, or a folder of notes is enough. Headings become navigation, fenced
				code gets highlighting, and a Mermaid fence becomes a diagram.
			</p>
			<p>Add a builtin component when it helps explain something:</p>
			<CodeBlock title="notes/first-idea.md" language="mdx" code={firstIdea} />
			<p>
				<code>.md</code> and <code>.mdx</code> support the same syntax. Both can use the builtin
				components. They cannot import code or run expressions, and braces hold literal values only.
				Escape a literal brace as <code>\{"{"}</code>, or put code-like text in backticks.
			</p>

			<h2 id="read-edit-repeat">Read, edit, repeat</h2>
			<p>
				Use the sidebar to move between files. Search your served folders with <Kbd>⌘</Kbd>{" "}
				<Kbd>K</Kbd> or <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>. Toggle the theme from the top bar.
			</p>
			<p>
				Double-click a section, or use its pencil, to edit it. Save with <Kbd>⌘</Kbd> <Kbd>S</Kbd>{" "}
				or <Kbd>Ctrl</Kbd> <Kbd>S</Kbd>, or press <Kbd>Esc</Kbd> to cancel. Saving writes to the
				original file. Changes made in your usual text editor also update the open page.
			</p>
			<Callout tone="note" title="These are your local files">
				Run mdxserve on your own machine for editing.
			</Callout>

			<h2 id="keep-a-few-folders-within-reach">Keep a few folders within reach</h2>
			<CodeBlock
				language="bash"
				code={`mdxserve serve -w ~/notes -w ~/work/docs
mdxserve roots add ~/another-project/docs
mdxserve roots list
mdxserve status`}
			/>
			<p>
				mdxserve runs one server per user. It remembers mounted folders in{" "}
				<code>~/.mdxserve/config.json</code>, so you can start it again with{" "}
				<code>mdxserve serve</code>.
			</p>

			<h2 id="give-your-agent-the-same-tools">Give your agent the same tools</h2>
			<p>Install the writing skill for Claude Code and Codex:</p>
			<CodeBlock language="bash" code="mdxserve setup" />
			<p>Inspect the available components or check a document from the terminal:</p>
			<CodeBlock
				language="bash"
				code={`mdxserve components search
mdxserve components show Callout
mdxserve validate ./docs/guide.md --json`}
			/>
			<p>
				Validation reads the file and checks syntax, the document rules, and component usage. It
				never renders the document and does not need a server.
			</p>
			<p>
				<Link to="/tour">Take the tour</Link> or{" "}
				<a href="https://github.com/karimsa/mdxserve">read the project on GitHub</a>.
			</p>
		</article>
	);
}
