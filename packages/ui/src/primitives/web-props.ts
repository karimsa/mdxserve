import { Platform } from "react-native";

/**
 * Props only react-native-web understands: an ARIA role React Native has no name for
 * (`paragraph`), `aria-controls`, `dataSet` (the element's `data-*` attributes) and DOM
 * keyboard handlers. React Native's types reject them and a device has no use for them, so
 * they are spread from here: the web gets them, native gets nothing.
 */
export function webProps(props: Readonly<Record<string, unknown>>): object {
	return Platform.OS === "web" ? props : {};
}
