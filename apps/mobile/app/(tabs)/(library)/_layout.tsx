import { Stack } from "expo-router";
import { WORDMARK_HEADER } from "../../../src/header";

/**
 * The Library tab's stack: the Library, folders, documents, Settings and the gallery. Its
 * screens open inside the tab, so the tab items stay where iOS put them.
 */
export default function LibraryStack() {
	return <Stack screenOptions={WORDMARK_HEADER} />;
}
