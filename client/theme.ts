import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "mdxserve-theme";
const MEDIA = "(prefers-color-scheme: dark)";

function systemTheme(): Theme {
	return window.matchMedia(MEDIA).matches ? "dark" : "light";
}

function storedTheme(): Theme | null {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		return value === "light" || value === "dark" ? value : null;
	} catch {
		return null;
	}
}

function applyTheme(theme: Theme): void {
	document.documentElement.setAttribute("data-theme", theme);
}

/**
 * The page theme. `src/http/html.ts` sets `data-theme` on `<html>` before the
 * stylesheet loads (same rules as here) so there is no flash; this hook keeps
 * that attribute, localStorage, and React state in sync afterwards.
 *
 * An explicit choice is persisted; "follow the system" is represented by the
 * absence of a stored value, so the OS setting keeps working until the reader
 * picks a side.
 */
export function useTheme(): { theme: Theme; toggle: () => void; set: (theme: Theme) => void } {
	const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);

	// Follow OS changes only while the reader has not chosen explicitly.
	useEffect(() => {
		const mql = window.matchMedia(MEDIA);
		const onChange = () => {
			if (storedTheme() === null) setTheme(systemTheme());
		};
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, []);

	const set = useCallback((next: Theme) => {
		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// private mode / storage disabled: the choice just won't persist
		}
		setTheme(next);
	}, []);

	const toggle = useCallback(() => {
		set(theme === "dark" ? "light" : "dark");
	}, [theme, set]);

	return { theme, toggle, set };
}
