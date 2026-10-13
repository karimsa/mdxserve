import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notifyAboutUpdates } from "../../src/cli/updates.js";
import { readPackageVersion } from "../../src/infra/pkg.js";

const notifier = vi.hoisted(() => ({
	create: vi.fn(),
	notify: vi.fn(),
}));

vi.mock("update-notifier", () => ({
	default: notifier.create,
}));

const originalArguments = process.argv;
const originalStdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const originalStderrTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
const originalDisableFlag = process.env.NO_UPDATE_NOTIFIER;

beforeEach(() => {
	process.argv = ["node", "mdxserve", "status"];
	Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
	Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
	delete process.env.NO_UPDATE_NOTIFIER;
	notifier.create.mockReset().mockReturnValue({ notify: notifier.notify });
	notifier.notify.mockReset();
});

afterEach(() => {
	process.argv = originalArguments;
	if (originalStdoutTTY) Object.defineProperty(process.stdout, "isTTY", originalStdoutTTY);
	else Reflect.deleteProperty(process.stdout, "isTTY");
	if (originalStderrTTY) Object.defineProperty(process.stderr, "isTTY", originalStderrTTY);
	else Reflect.deleteProperty(process.stderr, "isTTY");
	if (originalDisableFlag === undefined) delete process.env.NO_UPDATE_NOTIFIER;
	else process.env.NO_UPDATE_NOTIFIER = originalDisableFlag;
});

it("shows a cached update notice for an interactive command", async () => {
	await notifyAboutUpdates();
	expect(notifier.create).toHaveBeenCalledWith({
		pkg: { name: "@karimsa/mdxserve", version: readPackageVersion() },
		updateCheckInterval: 24 * 60 * 60 * 1000,
	});
	expect(notifier.notify).toHaveBeenCalledWith({ defer: false });
});

it.each(["--json", "--no-update-notifier", "--version", "--help"])(
	"omits update notices for %s",
	async (argument) => {
		process.argv.push(argument);
		await notifyAboutUpdates();
		expect(notifier.create).not.toHaveBeenCalled();
	},
);

it("omits update notices for noninteractive output and the environment opt-out", async () => {
	Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
	await notifyAboutUpdates();
	Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
	process.env.NO_UPDATE_NOTIFIER = "1";
	await notifyAboutUpdates();
	expect(notifier.create).not.toHaveBeenCalled();
});

it("keeps the CLI running when the optional notifier fails", async () => {
	notifier.create.mockImplementationOnce(() => {
		throw new Error("offline");
	});
	await expect(notifyAboutUpdates()).resolves.toBeUndefined();
});
