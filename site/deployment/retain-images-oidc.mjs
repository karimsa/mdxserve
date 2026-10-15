import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { retainImages } from "./retain-images.mjs";

const apiOrigin = "https://api.vercel.com";
const audience = "https://github.com/karimsa";
// Public OAuth client used by vercel/vcr-action for registry token exchange.
const vcrClientId = "cl_inrfNy8noLlhRrGbPEm0z47woXNcJVZ0";
const oauthErrors = new Set([
	"invalid_request",
	"invalid_client",
	"invalid_grant",
	"unauthorized_client",
	"unsupported_grant_type",
	"invalid_scope",
	"access_denied",
]);

function validToken(value) {
	return typeof value === "string" && /^[A-Za-z0-9._~-]+$/.test(value);
}

async function exchangeDiagnostic(response, secrets) {
	let body;
	try {
		body = await response.json();
	} catch {
		return "";
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) return "";
	const code = oauthErrors.has(body.error) ? body.error : "unknown_error";
	if (typeof body.error_description !== "string") return ` (${code})`;
	let description = body.error_description;
	for (const secret of [...secrets, body.access_token]) {
		if (typeof secret === "string" && secret)
			description = description.replaceAll(secret, "redacted");
	}
	description = description
		.replace(/[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,}){2,}/g, "redacted")
		.replace(/[A-Za-z0-9_-]{24,}/g, "redacted")
		.replace(/[^A-Za-z0-9 .,;:'"()/_=-]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 160);
	return description ? ` (${code}: ${description})` : ` (${code})`;
}

async function request(
	fetchImpl,
	url,
	options,
	label,
	{ retries = 0, sleep = delay, diagnose } = {},
) {
	for (let attempt = 0; attempt <= retries; attempt += 1) {
		let response;
		try {
			response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(10_000) });
		} catch {
			if (attempt < retries) {
				await sleep(1000 * (attempt + 1));
				continue;
			}
			throw new Error(`${label} request failed`);
		}
		if (response.ok) return response;
		if (attempt < retries && (response.status === 429 || response.status >= 500)) {
			await sleep(1000 * (attempt + 1));
			continue;
		}
		const detail = diagnose ? await diagnose(response) : "";
		throw new Error(`${label} returned HTTP ${response.status}${detail}`);
	}
}

async function tokenJson(response, field, label) {
	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error(`${label} returned an invalid token response`);
	}
	if (!validToken(body?.[field])) throw new Error(`${label} returned an invalid token response`);
	return body[field];
}

export async function retainImagesWithOidc({
	env = process.env,
	apply = false,
	fetchImpl = fetch,
	retain = retainImages,
	maskToken = (token) => process.stdout.write(`::add-mask::${token}\n`),
	warn = (message) => process.stderr.write(`::warning::${message}\n`),
	sleep = delay,
}) {
	if (
		!env.VERCEL_TOKEN ||
		!/^team_[A-Za-z0-9]+$/.test(env.VERCEL_ORG_ID) ||
		!/^prj_[A-Za-z0-9]+$/.test(env.VERCEL_PROJECT_ID) ||
		!env.GH_TOKEN ||
		!validToken(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
	) {
		throw new Error("Retention workflow credentials and project IDs are required");
	}
	let oidcUrl;
	try {
		oidcUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
	} catch {
		throw new Error("GitHub OIDC request URL is invalid");
	}
	if (
		oidcUrl.protocol !== "https:" ||
		!oidcUrl.hostname.endsWith(".actions.githubusercontent.com") ||
		oidcUrl.username ||
		oidcUrl.password ||
		oidcUrl.hash
	) {
		throw new Error("GitHub OIDC request URL is invalid");
	}
	oidcUrl.searchParams.set("audience", audience);
	const oidcResponse = await request(
		fetchImpl,
		oidcUrl,
		{ headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } },
		"GitHub OIDC token request",
	);
	const oidcToken = await tokenJson(oidcResponse, "value", "GitHub OIDC token request");
	const exchangeBody = new URLSearchParams({
		grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
		client_id: vcrClientId,
		subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
		requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
		team_id_or_slug: env.VERCEL_ORG_ID,
		subject_token: oidcToken,
	});
	const exchangeResponse = await request(
		fetchImpl,
		new URL("/login/oauth/token", apiOrigin),
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: exchangeBody,
		},
		"Vercel VCR token exchange",
		{
			retries: 2,
			sleep,
			diagnose: (response) =>
				exchangeDiagnostic(response, [
					oidcToken,
					env.VERCEL_TOKEN,
					env.GH_TOKEN,
					env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
				]),
		},
	);
	const registryToken = await tokenJson(
		exchangeResponse,
		"access_token",
		"Vercel VCR token exchange",
	);
	try {
		maskToken(registryToken);
		return await retain({
			token: env.VERCEL_TOKEN,
			registryToken,
			teamId: env.VERCEL_ORG_ID,
			projectId: env.VERCEL_PROJECT_ID,
			githubToken: env.GH_TOKEN,
			apply,
			fetchImpl,
		});
	} finally {
		try {
			await request(
				fetchImpl,
				new URL("/login/oauth/token/revoke", apiOrigin),
				{
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						client_id: vcrClientId,
						token: registryToken,
						token_type_hint: "access_token",
					}),
				},
				"Vercel VCR token revocation",
			);
		} catch (error) {
			warn(error.message);
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const apply = process.argv.includes("--apply");
	if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--apply")) {
		throw new Error("Usage: node site/deployment/retain-images-oidc.mjs [--apply]");
	}
	const result = await retainImagesWithOidc({ apply });
	process.stdout.write(
		result.deferred
			? `Deferred image cleanup while a release runs; deleted ${result.deleted} images\n`
			: apply
				? `Deleted ${result.deleted} images; kept production ${result.productionId} and newest ${result.newestId ?? "none"}\n`
				: `Preview: keep production ${result.productionId} and newest ${result.newestId ?? "none"}; delete ${result.deleteIds.length} images\n`,
	);
}
