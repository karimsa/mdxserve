import { Stack } from "expo-router";
import { Wordmark } from "@mdxserve/ui/brand/Wordmark";

/** The header's title on every Library screen: the wordmark the web client's top bar shows. */
function HeaderWordmark() {
	return <Wordmark />;
}

/**
 * The Library tab's stack: the Library, folders, documents, Settings and the gallery. Its
 * screens open inside the tab, so the tab items stay where iOS put them, and every header
 * shows the wordmark in the same place; a back item without a title keeps it from moving.
 * Each screen still sets its `title`, which is what the back menu and VoiceOver read.
 */
export default function LibraryStack() {
	return (
		<Stack
			screenOptions={{ headerTitle: HeaderWordmark, headerBackButtonDisplayMode: "minimal" }}
		/>
	);
}
