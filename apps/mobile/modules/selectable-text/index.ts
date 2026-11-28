import { requireNativeView, requireOptionalNativeModule } from "expo";
import { createElement, type ComponentType } from "react";
import { Platform, type NativeSyntheticEvent, type ViewProps } from "react-native";

/** One run of a block's text in one style, as the native view draws it (ios/SelectableTextModule.swift). */
export interface NativeTextRun {
	text: string;
	fontFamily: string;
	/** 100 to 900. */
	fontWeight: number;
	/** Points, before `fontScale`. */
	fontSize: number;
	italic: boolean;
	/** `processColor`'s number. */
	color: number;
	backgroundColor: number | null;
	rounded: boolean;
	strikethrough: boolean;
	pressable: boolean;
	/** Space after each character, in points (React Native's `letterSpacing`). */
	letterSpacing: number;
	/** The index of the run of the block's text this is drawn from, which presses report. */
	source: number;
}

export interface SelectableTextProps extends ViewProps {
	runs: readonly NativeTextRun[];
	/** Points, before `fontScale`. */
	lineHeight: number;
	/** The reader's text size, which `Text` applies to its font and line height. */
	fontScale: number;
	/** The selection menu's extra item; absent, the menu has only the system's (Copy…). */
	commentTitle?: string;
	/** The links and highlights as VoiceOver actions: a label, and the run a press reports. */
	actions: readonly { name: string; index: number }[];
	heading: boolean;
	/** The reader chose the extra item: the selection, in UTF-16 units of the runs' joined text. */
	onComment?: (event: NativeSyntheticEvent<{ start: number; end: number; text: string }>) => void;
	/** The reader tapped a pressable run. */
	onPressRun?: (event: NativeSyntheticEvent<{ index: number }>) => void;
	/** The height the text needs at the view's width. */
	onTextHeight?: (event: NativeSyntheticEvent<{ height: number }>) => void;
}

/** What the native view takes: the runs and actions as JSON, which Swift decodes with its own types. */
type NativeProps = Omit<SelectableTextProps, "runs" | "actions"> & {
	runs: string;
	actions: string;
};

function nativeView(): ComponentType<SelectableTextProps> {
	const Native = requireNativeView<NativeProps>("SelectableText");
	return function SelectableText({ runs, actions, ...props }: SelectableTextProps) {
		return createElement(Native, {
			...props,
			runs: JSON.stringify(runs),
			actions: JSON.stringify(actions),
		});
	};
}

/**
 * The selectable text view, or null where its native code is absent: Expo Go, Android and the
 * tests. Only the development build has it. The module is looked up before the view, so an app
 * without it never asks React Native for a view it has not got.
 */
export const SelectableTextView: ComponentType<SelectableTextProps> | null =
	Platform.OS === "ios" && requireOptionalNativeModule("SelectableText") !== null
		? nativeView()
		: null;
