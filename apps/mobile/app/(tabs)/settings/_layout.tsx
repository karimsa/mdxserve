import { Stack } from "expo-router";
import { WORDMARK_HEADER } from "../../../src/header";

/** The tab's own navigation stack, under the same wordmark header as every tab. */
export default function TabStack() {
	return <Stack screenOptions={WORDMARK_HEADER} />;
}
