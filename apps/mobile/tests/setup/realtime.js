// The app opens a live update socket to every server it reaches. Under jest no server answers,
// so every test gets a socket that never connects; a test that needs one replaces this mock.
jest.mock("@mdxserve/client/realtime", () => ({
	createRealtime: () => ({
		joinDocument() {},
		leaveDocument() {},
		onDocChanged: () => () => {},
		onListingChanged: () => () => {},
		onRootsChanged: () => () => {},
		close() {},
	}),
}));
