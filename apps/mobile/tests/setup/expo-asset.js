// The diagram page is an asset (src/diagram/diagram-page.ts). jest has no Metro to serve it,
// so expo-asset hands back the local file:// URI a device would.
jest.mock("expo-asset", () => ({
	useAssets: () => [[{ localUri: "file:///diagram.html" }], undefined],
}));
