import { ServerInfoService, type ServerIdentity } from "../../src/server-info/service.js";

/** The identity test contexts carry: a fixed id, so assertions can name it. */
export const TEST_IDENTITY: ServerIdentity = {
	id: "5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e",
	name: "test-box",
	version: "0.0.0-test",
	permissions: "full",
	mermaidVersion: "10.9.8",
};

/** A `ServerInfoService` with the test identity and no tailnet addresses. */
export function testServerInfo(
	identity: Partial<ServerIdentity> = {},
	tailnetHosts?: Iterable<string>,
): ServerInfoService {
	const hosts: ReadonlySet<string> = new Set(tailnetHosts);
	return new ServerInfoService(
		{ ...TEST_IDENTITY, ...identity },
		tailnetHosts === undefined ? undefined : { current: () => hosts },
	);
}
