// jest-expo's stand-in for the ExpoNetwork native module returns no subscription from
// addListener; a device returns one with `remove`. The app subscribes in its root layout.
jest.mock("expo-network", () => ({
	...jest.requireActual("expo-network"),
	addNetworkStateListener: () => ({ remove() {} }),
}));
