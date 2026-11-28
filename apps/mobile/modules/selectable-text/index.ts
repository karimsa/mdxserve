import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
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
}

export interface SelectableTextProps extends ViewProps {
	runs: readonly NativeTextRun[];
	/** Points, before `fontScale`. */
	lineHeight: number;
	/** The reader's text size, which `Text` applies to its font and line height. */
	fontScale: number;
	/** The selection menu's extra item; absent, the menu has only the system's (Copy…). */
	commentTitle?: string;
	heading: boolean;
	/** The reader chose the extra item: the selection, in UTF-16 units of the runs' joined text. */
	onComment?: (event: NativeSyntheticEvent<{ start: number; end: number; text: string }>) => void;
	/** The reader tapped a pressable run. */
	onPressRun?: (event: NativeSyntheticEvent<{ index: number }>) => void;
	/** The height the text needs at the view's width. */
	onTextHeight?: (event: NativeSyntheticEvent<{ height: number }>) => void;
}

/**
 * The selectable text view, or null where its native code is absent: Expo Go, Android and the
 * tests. Only the development build has it. The module is looked up before the view, so an app
 * without it never asks React Native for a view it has not got.
 */
export const SelectableTextView: ComponentType<SelectableTextProps> | null =
	Platform.OS === "ios" && requireOptionalNativeModule("SelectableText") !== null
		? requireNativeView<SelectableTextProps>("SelectableText")
		: null;
