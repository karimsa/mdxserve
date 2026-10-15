import assert from "node:assert/strict";
import test from "node:test";
import { planImageRetention, retainImages } from "./retain-images.mjs";

const productionSha = "a".repeat(40);
const options = { token: "project-token", teamId: "team_123", projectId: "prj_123" };

function image(id, tag, day) {
	return {
		id: `image_${id}`,
		repositoryId: "repo_123",
		kind: "manifest",
		status: "ready",
		createdAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`,
		tags: tag ? [tag] : [],
	};
}

function inventory() {
	return [
		image("production", "a".repeat(12), 1),
		image("newest", "b".repeat(12), 4),
		image("older", "c".repeat(12), 3),
		image("untagged", null, 2),
	];
}

function reply(body) {
	return { ok: true, status: 200, json: async () => body };
}

function harness(startingImages = inventory()) {
	let images = structuredClone(startingImages);
	let currentSha = productionSha;
	let deploymentId = "dpl_Production";
	const deleted = [];
	const calls = [];
	return {
		deleted,
		calls,
		setProduction(sha, id) {
			currentSha = sha;
			deploymentId = id;
		},
		addImage(entry) {
			images.push(entry);
		},
		remaining() {
			return images.map((entry) => entry.id);
		},
		fetchImpl: async (url) => {
			const pathname = new URL(url).pathname;
			if (pathname.includes("/aliases/")) {
				return reply({
					alias: "mdxserve.karim.build",
					projectId: options.projectId,
					deploymentId,
				});
			}
			return reply({
				id: deploymentId,
				projectId: options.projectId,
				readyState: "READY",
				gitSource: { sha: currentSha },
				meta: { githubCommitSha: currentSha },
			});
		},
		runCli: async (args) => {
			calls.push(args);
			if (args[0] === "ls") return JSON.stringify({ images });
			const id = args[2];
			deleted.push(id);
			images = images.filter((entry) => entry.id !== id);
			return JSON.stringify({ imageId: id, repository: "site", deleted: true });
		},
	};
}

test("keeps production even when it is old, plus the newest other image", () => {
	const plan = planImageRetention(inventory(), productionSha);
	assert.equal(plan.productionId, "image_production");
	assert.equal(plan.newestId, "image_newest");
	assert.deepEqual(plan.deleteIds, ["image_untagged", "image_older"]);
});

test("an untagged recent image does not occupy the second retained slot", () => {
	const images = inventory().map((entry) =>
		entry.id === "image_untagged" ? { ...entry, createdAt: "2026-10-05T12:00:00.000Z" } : entry,
	);
	const plan = planImageRetention(images, productionSha);
	assert.equal(plan.newestId, "image_newest");
	assert.deepEqual(plan.deleteIds, ["image_older", "image_untagged"]);
});

test("fails closed on missing or ambiguous production images and unexpected tags", () => {
	assert.throws(
		() => planImageRetention(inventory(), "d".repeat(40)),
		/Production image is missing/,
	);
	assert.throws(
		() =>
			planImageRetention([...inventory(), image("duplicate", "a".repeat(12), 5)], productionSha),
		/duplicate tags/,
	);
	assert.throws(
		() =>
			planImageRetention([{ ...inventory()[0], tags: ["a".repeat(12), "extra"] }], productionSha),
		/unexpected image metadata/,
	);
	assert.throws(
		() =>
			planImageRetention(
				[
					{ ...inventory()[0], repositoryId: "repo_123" },
					{ ...inventory()[1], repositoryId: "repo_other" },
				],
				productionSha,
			),
		/unexpected image metadata/,
	);
});

test("previews without deleting and scopes registry commands to the project", async () => {
	const fake = harness();
	const result = await retainImages({ ...options, ...fake });
	assert.equal(result.deleteIds.length, 2);
	assert.deepEqual(fake.deleted, []);
	assert.equal(fake.calls.length, 1);
	assert.deepEqual(fake.calls[0].slice(0, 4), ["ls", "site", "--project", options.projectId]);
	assert.ok(fake.calls[0].includes(options.teamId));
});

test("rechecks the live alias and inventory before each deletion", async () => {
	const fake = harness();
	const runCli = fake.runCli;
	fake.runCli = async (args) => {
		const result = await runCli(args);
		if (args[0] === "rm" && fake.deleted.length === 1) {
			fake.setProduction("c".repeat(40), "dpl_Promoted");
			fake.addImage(image("incoming", "e".repeat(12), 5));
		}
		return result;
	};
	const result = await retainImages({ ...options, ...fake, apply: true });
	assert.equal(result.deleted, 3);
	assert.deepEqual(fake.remaining().sort(), ["image_incoming", "image_older"].sort());
	assert.ok(!fake.deleted.includes("image_older"));
	assert.ok(!fake.deleted.includes("image_incoming"));
	assert.equal(fake.calls.filter((args) => args[0] === "ls").length, result.deleted + 1);
	assert.ok(fake.calls.filter((args) => args[0] === "rm").every((args) => args.includes("--yes")));
});

test("does not delete if the live production alias or SHA is untrustworthy", async () => {
	for (const invalid of [{ projectId: "prj_other" }, { deploymentId: "invalid" }]) {
		const fake = harness();
		const fetchImpl = fake.fetchImpl;
		fake.fetchImpl = async (url) => {
			const response = await fetchImpl(url);
			if (new URL(url).pathname.includes("/aliases/")) {
				return reply({ ...(await response.json()), ...invalid });
			}
			return response;
		};
		await assert.rejects(
			retainImages({ ...options, ...fake, apply: true }),
			/invalid project or deployment/,
		);
		assert.deepEqual(fake.deleted, []);
	}
	const fake = harness();
	fake.setProduction("short-sha", "dpl_Production");
	await assert.rejects(
		retainImages({ ...options, ...fake, apply: true }),
		/trustworthy commit SHA/,
	);
	assert.deepEqual(fake.deleted, []);
});

test("stops when the CLI does not confirm deletion", async () => {
	const fake = harness();
	const runCli = fake.runCli;
	fake.runCli = async (args) =>
		args[0] === "rm" ? JSON.stringify({ deleted: false }) : runCli(args);
	await assert.rejects(retainImages({ ...options, ...fake, apply: true }), /did not confirm/);
	assert.deepEqual(fake.deleted, []);
});
