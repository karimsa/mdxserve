import { Component, useState, type ReactNode } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
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
import type { DocumentEnvironment, TabsView } from "@mdxserve/ui/document/environment";

/** A `Tabs` node, its selection kept while the document is on screen. */
function DocumentTabs({ id, defaultValue, tabs }: TabsView) {
	const [selected, setSelected] = useState(
		tabs.some((tab) => tab.value === defaultValue) ? defaultValue : (tabs[0]?.value ?? ""),
	);
	return <Tabs id={id} tabs={tabs} selected={selected} onSelect={setSelected} />;
}

/** A builtin that threw while rendering: its message in its place, the rest of the document intact. */
class BuiltinErrorBoundary extends Component<
	{ resetKey: unknown; children: ReactNode },
	{ error: Error | null; resetKey: unknown }
> {
	state = { error: null as Error | null, resetKey: this.props.resetKey };

	static getDerivedStateFromProps(
		props: { resetKey: unknown },
		state: { error: Error | null; resetKey: unknown },
	) {
		return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
	}

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	render() {
		if (!this.state.error) return this.props.children;
		return (
			<View
				role="alert"
				className="my-2 rounded border border-status-danger-fg/30 bg-status-danger-bg p-4"
			>
				<Text className="font-sans font-semibold text-[length:var(--size-sm)] text-status-danger-fg">
					{`This component could not be shown: ${this.state.error.message}`}
				</Text>
			</View>
		);
	}
}

/**
 * The app's side of the shared node renderers (@mdxserve/ui/document/nodes): the shared
 * builtins, code as a plain monospace frame until the app highlights code (U6) and draws Mermaid
 * in a WebView (phase 4), and web links opened in the browser. Images load from their `src`
 * until the document screen (phase 4) supplies the server's asset URL.
 */
export const appDocumentEnvironment: DocumentEnvironment = {
	components: {
		Badge,
		Callout,
		Card,
		CardGrid,
		Chart,
		DataTable,
		Diff,
		FileTree,
		Kbd,
		Screenshot,
		Sparkline,
		Tooltip,
	},
	renderTabs: (view) => <DocumentTabs {...view} />,
	renderCode: (node) => (
		<View className="my-2 overflow-hidden rounded-lg border border-code-border bg-code-bg">
			{node.title || node.lang ? (
				<View className="h-[38px] justify-center border-b border-code-border px-4">
					<Text className="font-mono text-[length:var(--size-xs)] text-text-subtle">
						{node.title ?? node.lang}
					</Text>
				</View>
			) : null}
			<ScrollView horizontal={true} showsHorizontalScrollIndicator={false}>
				<Text className="p-4 font-mono text-[length:var(--size-xs)] leading-5 text-code-fg">
					{node.value}
				</Text>
			</ScrollView>
		</View>
	),
	assetUrl: (src) => src,
	openLink: (href) => {
		if (/^(https?|mailto):/i.test(href)) void Linking.openURL(href);
	},
	ErrorBoundary: BuiltinErrorBoundary,
};
