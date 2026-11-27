import { highlightParts } from "@mdxserve/client/search-highlight";
import { ActivityIndicator, View } from "react-native";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Text } from "@mdxserve/ui/primitives/Text";
import type { SearchHit, SearchRow } from "./sections";

/** `text` with the matched terms in the accent colour, as the web's search dialog marks them. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
	return highlightParts(text, terms).map((part, index) =>
		part.match ? (
			<Text key={index} tone="accent" weight="semibold">
				{part.text}
			</Text>
		) : (
			part.text
		),
	);
}

/** One row of a server's section: a hit, or the server's state. */
export function SearchRowView({
	row,
	onOpen,
}: {
	row: SearchRow;
	onOpen: (hit: SearchHit) => void;
}) {
	if (row.kind === "result") {
		const { hit } = row;
		return (
			<Pressable
				onPress={() => onOpen(hit)}
				accessibilityLabel={`${hit.title}, ${hit.label}`}
				className="flex-row items-start gap-3 border-b border-border-subtle py-3"
			>
				<Icon name="file-text" size="md" className="text-text-subtle" />
				<View className="flex-1">
					<Text weight="semibold" numberOfLines={1}>
						<Highlighted text={hit.title} terms={hit.terms} />
					</Text>
					<Text size="sm" tone="muted" numberOfLines={1} ellipsizeMode="head">
						{hit.label}
					</Text>
					{hit.excerpt === "" ? null : (
						<Text size="sm" numberOfLines={2}>
							<Highlighted text={hit.excerpt} terms={hit.terms} />
						</Text>
					)}
				</View>
			</Pressable>
		);
	}
	return (
		<View className="flex-row items-center gap-3 border-b border-border-subtle py-3">
			{row.kind === "loading" ? (
				<ActivityIndicator size="small" />
			) : (
				<Icon
					name={row.kind === "unreachable" ? "cloud-off" : "search-x"}
					size="md"
					className="text-text-subtle"
				/>
			)}
			<Text tone="muted">
				{row.kind === "loading"
					? "Searching…"
					: row.kind === "unreachable"
						? row.message
						: "No matches"}
			</Text>
		</View>
	);
}
