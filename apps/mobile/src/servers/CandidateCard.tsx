import { View } from "react-native";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Text } from "@mdxserve/ui/primitives/Text";
import type { ConfirmedCandidate } from "./candidate";
import type { KnownServer } from "./store";
import { TREE_SCHEMA_VERSION } from "./tree-schema";

/**
 * A server that answered as the one it claimed to be, before the reader adds it: its name, the
 * host it answered at, its version and permissions mode (I4), and Add. A server already saved
 * at that address says "Added"; one saved at other addresses offers "Add this address".
 */
export function CandidateCard({
	check,
	saved,
	onAdd,
}: {
	check: ConfirmedCandidate;
	saved: KnownServer | undefined;
	onAdd: () => void;
}) {
	const [first] = check.answered;
	const host = first === undefined ? "" : new URL(first.url).host;
	const alreadyAdded =
		saved !== undefined &&
		check.answered.every((origin) => saved.addresses.some((address) => address.url === origin.url));
	const action = saved === undefined ? "Add" : "Add this address";
	return (
		<View className="gap-1 rounded-md border border-border-default bg-surface-card p-4">
			<Text weight="semibold">{check.info.name}</Text>
			<Text tone="muted">{host}</Text>
			<Text size="sm" tone="muted">
				{`mdxserve ${check.info.version}, ${check.info.permissions} permissions`}
			</Text>
			{check.info.treeSchemaVersion > TREE_SCHEMA_VERSION ? (
				<Text size="sm">Update the app to read this server</Text>
			) : null}
			<View className="mt-3 flex-row">
				{alreadyAdded ? (
					<Text tone="muted" weight="semibold">
						Added
					</Text>
				) : (
					<Pressable onPress={onAdd} className="rounded-md bg-surface-accent-soft px-4 py-2">
						<Text weight="semibold" tone="accent">
							{action}
						</Text>
					</Pressable>
				)}
			</View>
		</View>
	);
}
