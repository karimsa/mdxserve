import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, renderRouter } from "expo-router/testing-library";
import { APP_ROUTES } from "./app-routes";

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

// The window's size, which a fold changes: the outer display folded, the inner one unfolded.
const FOLDED = { width: 393, height: 852, scale: 3, fontScale: 1 };
const UNFOLDED = { width: 951, height: 669, scale: 3, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => {
	const { useSyncExternalStore } = jest.requireActual<typeof import("react")>("react");
	const listeners = new Set<() => void>();
	const window = { current: { width: 393, height: 852, scale: 3, fontScale: 1 } };
	return {
		__esModule: true,
		resize(next: typeof window.current) {
			window.current = next;
			listeners.forEach((notify) => notify());
		},
		default: () =>
			useSyncExternalStore(
				(notify: () => void) => {
					listeners.add(notify);
					return () => listeners.delete(notify);
				},
				() => window.current,
			),
	};
});
const { resize } = jest.requireMock<{ resize(next: typeof FOLDED): void }>(
	"react-native/Libraries/Utilities/useWindowDimensions",
);

// expo-status-bar's native module, as Expo Go provides it (or, before 58.0.4, without the call).
// expo-status-bar looks the module up once, when it loads, so the lookup returns a stand-in
// that reads whichever module the test sets.
jest.mock("expo", () => {
	const nativeStatusBar: { current: Record<string, unknown> } = { current: {} };
	return {
		...jest.requireActual<object>("expo"),
		nativeStatusBar,
		requireOptionalNativeModule: (name: string) =>
			name === "ExpoStatusBar"
				? new Proxy({}, { get: (_target, key: string) => nativeStatusBar.current[key] })
				: null,
	};
});
const mockStatusBar = jest.requireMock<{ nativeStatusBar: { current: Record<string, unknown> } }>(
	"expo",
).nativeStatusBar;

describe("the vertical bar on a folding display", () => {
	let setVerticalBarBehavior: jest.Mock<(behavior: string) => void>;
	beforeEach(() => {
		setVerticalBarBehavior = jest.fn();
		mockStatusBar.current = { setVerticalBarBehavior };
	});

	it("leaves the vertical bar to iOS in a narrow window", async () => {
		resize(FOLDED);
		await renderRouter(APP_ROUTES);
		expect(setVerticalBarBehavior).not.toHaveBeenCalled();
	});

	it("keeps the bars at the top in a wide window, and hands them back when it narrows", async () => {
		resize(UNFOLDED);
		await renderRouter(APP_ROUTES);
		expect(setVerticalBarBehavior).toHaveBeenLastCalledWith("disabled");

		await act(async () => resize(FOLDED));
		expect(setVerticalBarBehavior).toHaveBeenLastCalledWith("automatic");
	});

	it("does nothing when the native module cannot set the behavior", async () => {
		mockStatusBar.current = {};
		resize(UNFOLDED);
		await renderRouter(APP_ROUTES);
		expect(setVerticalBarBehavior).not.toHaveBeenCalled();
	});
});
