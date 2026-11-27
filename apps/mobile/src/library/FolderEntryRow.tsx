import { View } from "react-native";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Text } from "@mdxserve/ui/primitives/Text";

/** One entry of `getFolderListing`. */
interface FolderEntry {
	name: string;
	isDir: boolean;
	isDoc: boolean;
	title?: string;
}

/**
 * A folder or a document opens; any other file in the folder is listed but not opened, since
 * the app reads only documents.
 */
export function FolderEntryRow({ entry, onOpen }: { entry: FolderEntry; onOpen: () => void }) {
	const label = entry.isDoc && entry.title ? entry.title : entry.name;
	const icon = entry.isDir ? "folder" : entry.isDoc ? "file-text" : "file";
	const content = (
		<>
			<Icon
				name={icon}
				size="md"
				className={entry.isDir ? "text-text-accent" : "text-text-subtle"}
			/>
			<View className="flex-1">
				<Text weight={entry.isDir || entry.isDoc ? "semibold" : "regular"}>{label}</Text>
				{label === entry.name ? null : (
					<Text size="sm" tone="muted">
						{entry.name}
					</Text>
				)}
			</View>
		</>
	);
	if (!entry.isDir && !entry.isDoc) {
		return (
			<View
				accessibilityLabel={label}
				className="flex-row items-center gap-3 border-b border-border-subtle py-3"
			>
				{content}
			</View>
		);
	}
	return (
		<Pressable
			onPress={onOpen}
			accessibilityLabel={entry.isDir ? `Folder ${label}` : `Document ${label}`}
			className="flex-row items-center gap-3 border-b border-border-subtle py-3"
		>
			{content}
			<Icon name="chevron-right" size="sm" className="text-text-subtle" />
		</Pressable>
	);
}
