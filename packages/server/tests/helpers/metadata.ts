import os from "node:os";
import { DocsService } from "../../src/docs/service.js";
import { RootsService } from "../../src/roots/service.js";
import { fixtureRegistry } from "../fixtures/registry.js";

export function createMetadataPort(): DocsService {
	return new DocsService(new RootsService(process.cwd(), os.homedir(), []), fixtureRegistry);
}
