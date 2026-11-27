import { useId, useState, type ReactNode } from "react";

/**
 * Static stand-ins for the reader's builtins. They only need to look like the
 * product: the site never runs mdxserve code.
 */

type Tone = "note" | "info" | "ok" | "warn" | "danger";

export function Callout({
	tone = "note",
	title,
	children,
}: {
	tone?: Tone;
	title: string;
	children: ReactNode;
}) {
	return (
		<aside className={`callout tone-${tone}`}>
			<p className="callout-title">{title}</p>
			<div className="callout-body">{children}</div>
		</aside>
	);
}

export function Badge({ tone = "ok", children }: { tone?: Tone; children: ReactNode }) {
	return (
		<span className={`badge tone-${tone}`}>
			<span className="badge-dot" aria-hidden="true" />
			{children}
		</span>
	);
}

export function Kbd({ children }: { children: ReactNode }) {
	return <kbd className="kbd">{children}</kbd>;
}

export function CodeBlock({
	code,
	title,
	language,
	lineNumbers = false,
	highlight = [],
}: {
	code: string;
	title?: string;
	language?: string;
	lineNumbers?: boolean;
	highlight?: number[];
}) {
	const lines = code.replace(/\n$/, "").split("\n");
	return (
		<figure className="code-block">
			{title || language ? (
				<figcaption className="code-title">
					<span>{title}</span>
					{language ? <span className="code-language">{language}</span> : null}
				</figcaption>
			) : null}
			<pre className={lineNumbers ? "with-line-numbers" : undefined}>
				<code>
					{lines.map((line, index) => (
						<span
							key={index}
							className={highlight.includes(index + 1) ? "code-line highlighted" : "code-line"}
							data-line={lineNumbers ? index + 1 : undefined}
						>
							{line || " "}
						</span>
					))}
				</code>
			</pre>
		</figure>
	);
}

export interface TabItem {
	label: string;
	content: ReactNode;
}

export function Tabs({ items }: { items: TabItem[] }) {
	const [selected, setSelected] = useState(0);
	const baseId = useId();
	return (
		<div className="tabs">
			<div className="tab-list" role="tablist">
				{items.map((item, index) => (
					<button
						key={item.label}
						type="button"
						role="tab"
						id={`${baseId}-tab-${index}`}
						aria-selected={index === selected}
						aria-controls={`${baseId}-panel-${index}`}
						tabIndex={index === selected ? 0 : -1}
						className="tab"
						onClick={() => setSelected(index)}
						onKeyDown={(event) => {
							if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
							const step = event.key === "ArrowRight" ? 1 : -1;
							const next = (selected + step + items.length) % items.length;
							setSelected(next);
							document.getElementById(`${baseId}-tab-${next}`)?.focus();
						}}
					>
						{item.label}
					</button>
				))}
			</div>
			{items.map((item, index) => (
				<div
					key={item.label}
					role="tabpanel"
					id={`${baseId}-panel-${index}`}
					aria-labelledby={`${baseId}-tab-${index}`}
					hidden={index !== selected}
					className="tab-panel prose"
				>
					{item.content}
				</div>
			))}
		</div>
	);
}

export function Diff({ title, before, after }: { title: string; before: string; after: string }) {
	const beforeLines = before.split("\n");
	const afterLines = after.split("\n");
	const rows: { kind: "same" | "removed" | "added"; text: string }[] = [];
	let beforeIndex = 0;
	let afterIndex = 0;
	// Enough of a diff for short, hand-written examples: walk both sides and
	// treat any line that differs as a removal followed by an addition.
	while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
		const removed = beforeLines[beforeIndex];
		const added = afterLines[afterIndex];
		if (removed !== undefined && removed === added) {
			rows.push({ kind: "same", text: removed });
			beforeIndex += 1;
			afterIndex += 1;
		} else if (removed !== undefined && !afterLines.slice(afterIndex).includes(removed)) {
			rows.push({ kind: "removed", text: removed });
			beforeIndex += 1;
		} else if (added !== undefined) {
			rows.push({ kind: "added", text: added });
			afterIndex += 1;
		} else {
			beforeIndex += 1;
		}
	}
	return (
		<figure className="code-block diff">
			<figcaption className="code-title">
				<span>{title}</span>
				<span className="code-language">diff</span>
			</figcaption>
			<pre>
				<code>
					{rows.map((row, index) => (
						<span key={index} className={`code-line diff-${row.kind}`}>
							<span className="diff-sign" aria-hidden="true">
								{row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "}
							</span>
							{row.text || " "}
						</span>
					))}
				</code>
			</pre>
		</figure>
	);
}
