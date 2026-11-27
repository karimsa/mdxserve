import { Stack, useRouter } from "expo-router";
import { useState, type ComponentProps } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Badge from "@mdxserve/ui/builtins/Badge";
import Callout from "@mdxserve/ui/builtins/Callout";
import Card, { CardGrid } from "@mdxserve/ui/builtins/Card";
import Diff from "@mdxserve/ui/builtins/Diff";
import FileTree from "@mdxserve/ui/builtins/FileTree";
import Kbd from "@mdxserve/ui/builtins/Kbd";
import DataTable from "@mdxserve/ui/builtins/DataTable";
import Chart from "@mdxserve/ui/builtins/Chart";
import Sparkline from "@mdxserve/ui/builtins/Sparkline";
import Screenshot from "@mdxserve/ui/builtins/Screenshot";
import Tooltip from "@mdxserve/ui/builtins/Tooltip";
import Tabs from "@mdxserve/ui/builtins/Tabs";
import { Wordmark } from "@mdxserve/ui/brand/Wordmark";
import { Code, Heading, Text } from "@mdxserve/ui/primitives/Text";
import { readAppInfo } from "../src/app-info";
import { useSideInsets } from "../src/side-insets";

const LATENCY = [
	{ label: "Mon", p50: 42, p99: 180 },
	{ label: "Tue", p50: 38, p99: 165 },
	{ label: "Wed", p50: 51, p99: 210 },
];

const TABS = [
	{ id: "sample>overview", value: "overview", label: "Overview" },
	{ id: "sample>details", value: "details", label: "Details" },
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

/** The header's title: the wordmark the web client's top bar shows. */
function HeaderWordmark() {
	return <Wordmark />;
}

/**
 * Placeholder home screen until the server list arrives (phase 4). Below the app's details it
 * shows the builtins the app shares with the web client (@mdxserve/ui).
 */
export default function Home() {
	const info = readAppInfo();
	const [tab, setTab] = useState("overview");
	const router = useRouter();
	const sideInsets = useSideInsets();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="home-content"
		>
			<Stack.Screen options={{ title: info.name, headerTitle: HeaderWordmark }} />
			{/* A native bar item with an icon: iOS puts it in the top bar, or in the vertical bar
			    beside the content when a folded display draws one. */}
			<Stack.Toolbar placement="right">
				<Stack.Toolbar.Button
					icon="server.rack"
					accessibilityLabel="Servers"
					onPress={() => router.push("/servers")}
				/>
				<Stack.Toolbar.Button
					icon="gearshape"
					accessibilityLabel="Settings"
					onPress={() => router.push("/settings")}
				/>
			</Stack.Toolbar>
			<Heading level={1}>{info.name}</Heading>
			<Text tone="muted">
				Version <Code>{info.version}</Code>
			</Text>
			<Text tone="muted">
				React Native <Code>{info.reactNativeVersion}</Code>
			</Text>
			<View style={styles.samples}>
				<View style={styles.row}>
					<Badge tone="ok" variant="soft" dot={true}>
						Online
					</Badge>
					<Badge tone="warn" variant="solid" dot={false}>
						Degraded
					</Badge>
					<Badge tone="teal" variant="outline" dot={false}>
						Shared
					</Badge>
				</View>
				<Callout tone="tip" title="From @mdxserve/ui">
					<Text>The web client renders this same component.</Text>
				</Callout>
				<Tabs
					id="sample"
					selected={tab}
					onSelect={setTab}
					tabs={TABS.map((entry) => ({
						...entry,
						content: <Text paragraph={true}>{`The ${entry.label} panel.`}</Text>,
					}))}
				/>
				<Text>
					Press <Kbd>⌘</Kbd>
					<Kbd>K</Kbd> to search. Press and hold{" "}
					<Tooltip content="A tooltip from @mdxserve/ui." placement="top" delay={100}>
						this word
					</Tooltip>
					.
				</Text>
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
						icon="git-branch"
						title="Diagrams"
						description="Mermaid flowcharts render inline."
						interactive={true}
					/>
				</CardGrid>
				<FileTree
					id="sample-tree"
					activePath="deploy"
					nodes={[
						{
							name: "docs",
							children: [
								{ name: "install.mdx", path: "install" },
								{ name: "deploy.mdx", path: "deploy" },
							],
						},
						{ name: "package.json" },
					]}
				/>
				<DataTable id="sample-table" caption="Releases" columns={TABLE_COLUMNS} data={TABLE_ROWS} />
				<Chart
					id="sample-chart"
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
				<Text>
					Requests{" "}
					<Sparkline
						values={[12, 18, 15, 22, 19, 27, 24, 31]}
						width={84}
						height={20}
						color="var(--chart-1)"
						fill
					/>
				</Text>
				<Diff
					id="sample-diff"
					title="server.ts"
					before={
						'const server = http.createServer(handler);\nserver.listen(3000);\nconsole.log("listening");'
					}
					after={
						"const server = http.createServer(handler);\nconst port = Number(process.env.PORT ?? 4040);\nserver.listen(port);\nconsole.log(`listening on ${port}`);"
					}
					view="unified"
					context={3}
				/>
				<Screenshot
					id="sample-screenshot"
					src="https://raw.githubusercontent.com/karimsa/mdxserve/main/example/assets/reader-light.jpg"
					alt="mdxserve rendering a Markdown document"
					title="mdxserve — 01-markdown.md"
					caption="Tap the expand control for a zoomable view."
				/>
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: {
		flexGrow: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
		paddingVertical: 16,
	},
	samples: { alignSelf: "stretch", gap: 16, marginTop: 24 },
	row: { flexDirection: "row", gap: 8 },
});
