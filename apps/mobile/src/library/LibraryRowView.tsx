import { ActivityIndicator, View } from "react-native";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Text } from "@mdxserve/ui/primitives/Text";
import { displayName, type KnownServer } from "../servers/store";
import type { LibraryRow, Root } from "./rows";

/** One Library row: a folder with its server's name beside it, or a server's state. */
export function LibraryRowView({
	row,
	onOpen,
}: {
	row: LibraryRow;
	onOpen: (server: KnownServer, root: Root) => void;
}) {
	const server = displayName(row.server);
	if (row.kind === "root") {
		return (
			<Pressable
				onPress={() => onOpen(row.server, row.root)}
				accessibilityLabel={`${row.root.name} on ${server}`}
				className="flex-row items-center gap-3 border-b border-border-subtle py-3"
			>
				<Icon name="folder" size="md" className="text-text-accent" />
				<View className="flex-1">
					<Text weight="semibold">{row.root.name}</Text>
					<Text size="sm" tone="muted">
						{server}
					</Text>
				</View>
				<Icon name="chevron-right" size="sm" className="text-text-subtle" />
			</Pressable>
		);
	}
	return (
		<View className="flex-row items-center gap-3 border-b border-border-subtle py-3">
			{row.kind === "loading" ? (
				<ActivityIndicator size="small" />
			) : (
				<Icon name="cloud-off" size="md" className="text-text-subtle" />
			)}
			<View className="flex-1">
				<Text weight="semibold">{server}</Text>
				<Text size="sm" tone="muted">
					{row.kind === "loading" ? "Loading folders…" : row.message}
				</Text>
			</View>
		</View>
	);
}
