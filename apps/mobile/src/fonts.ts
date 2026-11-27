import { Manrope_400Regular } from "@expo-google-fonts/manrope/400Regular";
import { Manrope_500Medium } from "@expo-google-fonts/manrope/500Medium";
import { Manrope_600SemiBold } from "@expo-google-fonts/manrope/600SemiBold";
import { Manrope_700Bold } from "@expo-google-fonts/manrope/700Bold";
import { Manrope_800ExtraBold } from "@expo-google-fonts/manrope/800ExtraBold";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium";
import { useFonts } from "expo-font";

/**
 * The web client's typefaces, one static file per weight the components use. Every Manrope
 * file names its family "Manrope" and every JetBrains Mono file "JetBrains Mono", the names
 * the design tokens give `--font-core` and `--font-mono` in the app, so a `Text` asks for the
 * family and React Native picks the face by `fontWeight`. The web loads the same faces from
 * @fontsource-variable; iOS cannot load those `.woff2` files.
 */
const FACES = {
	Manrope_400Regular,
	Manrope_500Medium,
	Manrope_600SemiBold,
	Manrope_700Bold,
	Manrope_800ExtraBold,
	JetBrainsMono_400Regular,
	JetBrainsMono_500Medium,
};

/** True once the faces are loaded, or failed to load (the system font then stands in). */
export function useAppFonts(): boolean {
	const [loaded, error] = useFonts(FACES);
	return loaded || error !== null;
}
