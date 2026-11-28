import { useLocalSearchParams } from "expo-router";
import { ContentsScreen } from "../src/document/ContentsScreen";

/**
 * A document's table of contents, presented as a sheet over the tabs (app/_layout.tsx). `view`
 * is the key its document opened it under (src/document/contents.ts).
 */
export default function Contents() {
	const { view } = useLocalSearchParams<{ view?: string }>();
	return <ContentsScreen viewKey={view ?? ""} />;
}
