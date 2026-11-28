import { Stack } from "expo-router";
import { useState, type ComponentProps, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Badge from "@mdxserve/ui/builtins/Badge";
import Callout from "@mdxserve/ui/builtins/Callout";
import Card, { CardGrid } from "@mdxserve/ui/builtins/Card";
import Chart from "@mdxserve/ui/builtins/Chart";
import DataTable from "@mdxserve/ui/builtins/DataTable";
import Diff from "@mdxserve/ui/builtins/Diff";
import FileTree from "@mdxserve/ui/builtins/FileTree";
import Kbd from "@mdxserve/ui/builtins/Kbd";
import Screenshot from "@mdxserve/ui/builtins/Screenshot";
import Sparkline from "@mdxserve/ui/builtins/Sparkline";
import Tabs from "@mdxserve/ui/builtins/Tabs";
import Tooltip from "@mdxserve/ui/builtins/Tooltip";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { List, ListItem } from "@mdxserve/ui/primitives/List";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Code, Heading, Link, Text } from "@mdxserve/ui/primitives/Text";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import type { CodeNode } from "@mdxserve/client/document/tree-types";
import { DiagramBlock } from "../../../src/diagram/DiagramBlock";
import { appDocumentEnvironment } from "../../../src/document-environment";
import { SAMPLE_DOCUMENT } from "../../../src/sample-document";
import { useSideInsets } from "../../../src/side-insets";

/*
 * Every component the app shares with the web client (@mdxserve/ui), with the fixtures of the
 * example documents (example/06-builtins.mdx, 07-charts.mdx, 12-data-tables.mdx), in the
 * system's light or dark theme: the screen to compare with the web client's pages (U4).
 */

const TABS = [
	{ id: "gallery-tabs>overview", value: "overview", label: "Overview" },
	{ id: "gallery-tabs>example-list", value: "example-list", label: "Example list" },
	{ id: "gallery-tabs>code", value: "code", label: "Code" },
];

const LATENCY = [
	{ label: "Mon", p50: 42, p99: 180 },
	{ label: "Tue", p50: 38, p99: 165 },
	{ label: "Wed", p50: 51, p99: 210 },
	{ label: "Thu", p50: 45, p99: 190 },
	{ label: "Fri", p50: 40, p99: 172 },
];

/** A small table, wider than a phone, to see the shared DataTable scroll sideways. */
const TABLE_COLUMNS: ComponentProps<typeof DataTable>["columns"] = [
	{ key: "version", label: "Version", type: "text" },
	{ key: "notes", label: "Notes", type: "text" },
	{ key: "size", label: "Bundle", type: "bytes", unit: "B", bars: true },
	{ key: "build", label: "Build time", type: "time", unit: "ms" },
];
const TABLE_ROWS = [
	{
		version: "0.6.0",
		notes: "Shared Badge, Callout and Tabs with the app",
		size: 3_100_000,
		build: 41_000,
	},
	{
		version: "0.7.0",
		notes: "Shared tokens, fonts and primitives",
		size: 4_400_000,
		build: 52_500,
	},
	{ version: "0.8.0", notes: "Shared DataTable", size: 4_450_000, build: 50_000 },
];

const DIFF_BEFORE = [
	"const server = http.createServer(handler);",
	"server.listen(3000);",
	'console.log("listening");',
].join("\n");
const DIFF_AFTER = [
	"const server = http.createServer(handler);",
	"const port = Number(process.env.PORT ?? 4040);",
	"server.listen(port);",
	"console.log(`listening on ${port}`);",
].join("\n");

/** The diagrams to check on a device: each kind the reader meets, a broken one and a refused one. */
const DIAGRAMS: { title: string | null; value: string }[] = [
	{
		title: "Left to right (top-down when folded)",
		value:
			"flowchart LR\n  Phone --> Tailnet --> Server\n  Server --> Docs[(Documents)]\n  Server -->|doc-changed| Phone",
	},
	{
		title: null,
		value:
			"sequenceDiagram\n  participant App\n  participant Server\n  App->>Server: getDocument\n  Server-->>App: tree\n  Note over App: draws each block",
	},
	{
		title: "Entities",
		value:
			"erDiagram\n  SERVER ||--o{ ROOT : mounts\n  ROOT ||--o{ DOCUMENT : holds\n  DOCUMENT {\n    string path\n    int version\n  }",
	},
	{
		title: null,
		value:
			"flowchart TD\n  accTitle: Release steps\n  accDescr: A branch, a pull request, a tag and a publish\n  Branch --> PR --> Tag --> Publish",
	},
	{ title: "Broken on purpose", value: "flowchart LR\n  A -->" },
	{ title: null, value: 'pie title Refused on purpose\n  "Yes" : 3\n  "No" : 1' },
];

const DIAGRAM_NODES: CodeNode[] = DIAGRAMS.map((diagram, index) => ({
	type: "code",
	id: `gallery-diagram-${index}`,
	lang: "mermaid",
	title: diagram.title,
	showLineNumbers: false,
	highlightLines: [],
	value: diagram.value,
}));

const TONES = ["neutral", "teal", "info", "ok", "warn", "danger", "note"] as const;
const CALLOUT_TONES = ["note", "tip", "ok", "warn", "danger"] as const;

/** One component's part of the gallery: its name as a heading, then the samples. */
function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<View style={styles.section}>
			<Heading level={2}>{title}</Heading>
			{children}
		</View>
	);
}

function Row({ children }: { children: ReactNode }) {
	return <View style={styles.row}>{children}</View>;
}

export default function Gallery() {
	const [tab, setTab] = useState("overview");
	const [presses, setPresses] = useState(0);
	const sideInsets = useSideInsets();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="gallery-content"
		>
			<Stack.Screen options={{ title: "Gallery" }} />

			<Section title="Diagrams">
				{DIAGRAM_NODES.map((node) => (
					<DiagramBlock key={node.id} node={node} />
				))}
			</Section>

			<Section title="Document">
				<DocumentEnvironmentProvider value={appDocumentEnvironment}>
					<NodeList nodes={SAMPLE_DOCUMENT} />
				</DocumentEnvironmentProvider>
			</Section>

			<Section title="Text">
				<Text size="lg" weight="bold" tone="heading">
					Large, bold, heading tone
				</Text>
				<Text>Body text in the medium size, regular weight.</Text>
				<Text size="sm" tone="muted">
					Small and muted.
				</Text>
				<Text size="xs" tone="subtle" weight="semibold">
					Extra small, subtle, semibold.
				</Text>
				<Text tone="accent" weight="medium">
					Accent, medium.
				</Text>
				<Text paragraph={true}>
					A paragraph with <Code>inline code</Code> and{" "}
					<Link href="https://github.com/karimsa/mdxserve">a link</Link>.
				</Text>
			</Section>

			<Section title="Heading">
				{([1, 2, 3, 4, 5, 6] as const).map((level) => (
					<Heading key={level} level={level}>{`Heading ${level}`}</Heading>
				))}
			</Section>

			<Section title="List">
				<List>
					{["Tabs remember which panel was active", "Arrow keys move between tabs"].map((item) => (
						<ListItem key={item}>
							<Text>{`• ${item}`}</Text>
						</ListItem>
					))}
				</List>
			</Section>

			<Section title="Pressable and Icon">
				<Pressable
					accessibilityLabel="Press me"
					onPress={() => setPresses((count) => count + 1)}
					className="flex-row items-center gap-2 self-start rounded-md border border-border-default bg-surface-card px-3 py-2"
				>
					<Icon name="mouse-pointer-click" size="md" className="text-text-accent" />
					<Text weight="semibold">{`Pressed ${presses} times`}</Text>
				</Pressable>
				<Row>
					{["info", "lightbulb", "circle-check", "triangle-alert", "rocket", "git-branch"].map(
						(name) => (
							<Icon key={name} name={name} size="xl" className="text-text-muted" />
						),
					)}
				</Row>
			</Section>

			<Section title="Callout">
				{CALLOUT_TONES.map((tone) => (
					<Callout key={tone} tone={tone}>
						<Text>{`tone="${tone}"`}</Text>
					</Callout>
				))}
			</Section>

			<Section title="Tooltip">
				<Text>
					Press and hold{" "}
					<Tooltip content="A tooltip on plain inline text." placement="top" delay={100}>
						this dotted word
					</Tooltip>{" "}
					to see a tooltip.
				</Text>
			</Section>

			<Section title="Tabs">
				<Tabs
					id="gallery-tabs"
					selected={tab}
					onSelect={setTab}
					tabs={TABS.map((entry) => ({
						...entry,
						content: <Text paragraph={true}>{`The ${entry.label} panel.`}</Text>,
					}))}
				/>
			</Section>

			<Section title="Badge">
				{(["soft", "solid", "outline"] as const).map((variant) => (
					<Row key={variant}>
						{TONES.map((tone) => (
							<Badge key={tone} tone={tone} variant={variant} dot={false}>
								{tone}
							</Badge>
						))}
					</Row>
				))}
				<Row>
					<Badge tone="ok" variant="soft" dot={true}>
						Online
					</Badge>
					<Badge tone="neutral" variant="soft" dot={true}>
						Offline
					</Badge>
					<Badge tone="warn" variant="soft" dot={true}>
						Degraded
					</Badge>
				</Row>
			</Section>

			<Section title="Diff">
				<Diff
					id="gallery-diff"
					title="server.ts"
					language="ts"
					before={DIFF_BEFORE}
					after={DIFF_AFTER}
					view="unified"
					context={3}
				/>
			</Section>

			<Section title="Card">
				<CardGrid columns="2">
					<Card
						icon="rocket"
						title="Getting started"
						description="Point mdxserve at a folder and it starts serving."
						href="https://github.com/karimsa/mdxserve"
						meta="2 min read"
						interactive={false}
					/>
					<Card
						icon="terminal"
						title="CLI reference"
						description="Every flag, its default, and what it changes."
						meta="Reference"
						interactive={false}
					/>
					<Card
						icon="git-branch"
						title="Diagrams"
						description="Mermaid flowcharts and sequence diagrams render inline."
						interactive={true}
					/>
				</CardGrid>
			</Section>

			<Section title="Kbd">
				<Text>
					Press <Kbd>⌘</Kbd>
					<Kbd>K</Kbd> to open search, or <Kbd>esc</Kbd> to close it.
				</Text>
			</Section>

			<Section title="FileTree">
				<FileTree
					id="gallery-tree"
					activePath="deploy"
					nodes={[
						{
							name: "docs",
							children: [
								{
									name: "guides",
									children: [
										{ name: "install.mdx", path: "install" },
										{ name: "deploy.mdx", path: "deploy" },
									],
								},
								{ name: "readme.md", path: "readme" },
							],
						},
						{ name: "package.json" },
					]}
				/>
			</Section>

			<Section title="Chart">
				<Chart
					id="gallery-chart"
					type="bar"
					orientation="vertical"
					data={LATENCY}
					series={["p50", "p99"]}
					values={[]}
					height={180}
					filename="requests.json"
					unit="ms"
					legend
				/>
			</Section>

			<Section title="Sparkline">
				<Text>
					Requests over the last hour:{" "}
					<Sparkline
						values={[12, 18, 15, 22, 19, 27, 24, 31]}
						width={84}
						height={20}
						color="var(--chart-1)"
						fill
					/>
					, trending up.
				</Text>
			</Section>

			<Section title="DataTable">
				<DataTable
					id="gallery-table"
					caption="Releases"
					columns={TABLE_COLUMNS}
					data={TABLE_ROWS}
				/>
			</Section>

			<Section title="Screenshot">
				<Screenshot
					id="gallery-screenshot"
					src="https://raw.githubusercontent.com/karimsa/mdxserve/main/example/assets/reader-light.jpg"
					alt="mdxserve rendering a Markdown document in the light theme"
					title="mdxserve — 01-markdown.md"
					caption="The reader view, with the table of contents pinned to the right."
				/>
			</Section>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { gap: 32, paddingVertical: 16 },
	section: { gap: 12 },
	row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
});
