import { useAssets } from "expo-asset";
import diagramPage from "../../assets/generated/diagram.html";

/**
 * The diagram page's local `file://` URI, or null until expo-asset has it. In Expo Go the asset
 * is fetched from Metro once and kept in the app's cache; in a build it ships inside the app.
 */
export function useDiagramPageUri(): string | null {
	const [assets] = useAssets(diagramPage);
	return assets?.[0]?.localUri ?? null;
}
