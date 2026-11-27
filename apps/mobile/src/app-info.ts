import Constants from "expo-constants";
import { Platform } from "react-native";

export interface AppInfo {
	name: string;
	version: string;
	reactNativeVersion: string;
}

interface ReactNativeVersion {
	major: number;
	minor: number;
	patch: number;
	prerelease?: string | number | null;
}

/**
 * `0.88.1`, or `0.89.0-rc.1` for a prerelease.
 *
 * @internal Exported for its tests.
 */
export function formatReactNativeVersion(version: ReactNativeVersion): string {
	const release = `${version.major}.${version.minor}.${version.patch}`;
	return version.prerelease === undefined || version.prerelease === null
		? release
		: `${release}-${version.prerelease}`;
}

/** What the placeholder screen shows: the app's name and version from app.config.ts, and React Native's version. */
export function readAppInfo(): AppInfo {
	return {
		name: Constants.expoConfig?.name ?? "mdxserve",
		version: Constants.expoConfig?.version ?? "unknown",
		reactNativeVersion: formatReactNativeVersion(Platform.constants.reactNativeVersion),
	};
}
