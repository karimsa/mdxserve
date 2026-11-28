import { useLocalSearchParams } from "expo-router";
import { DiagramScreen } from "../src/diagram/DiagramScreen";

/**
 * A Mermaid diagram's full screen view, presented over the tabs (app/_layout.tsx). `view` is
 * the key its block opened it under (src/diagram/diagram-views.ts).
 */
export default function Diagram() {
	const { view } = useLocalSearchParams<{ view?: string }>();
	return <DiagramScreen viewKey={view ?? ""} />;
}
