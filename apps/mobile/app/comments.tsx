import { useLocalSearchParams } from "expo-router";
import { CommentsSheet } from "../src/comments/CommentsSheet";

/**
 * A document's comments, presented as a sheet over the tabs (app/_layout.tsx). `view` is the
 * key its document opened it under (src/comments/sheet.ts).
 */
export default function Comments() {
	const { view } = useLocalSearchParams<{ view?: string }>();
	return <CommentsSheet viewKey={view ?? ""} />;
}
