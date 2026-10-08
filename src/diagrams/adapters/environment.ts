export function environment(): NodeJS.ProcessEnv {
	const result: NodeJS.ProcessEnv = {};
	for (const key of [
		"PATH",
		"PATHEXT",
		"COMSPEC",
		"HOME",
		"USER",
		"TMPDIR",
		"SYSTEMROOT",
		"LANG",
		"CODEX_HOME",
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_AUTH_TOKEN",
		"ANTHROPIC_BASE_URL",
		"CLAUDE_CODE_OAUTH_TOKEN",
		"CLAUDE_CONFIG_DIR",
		"HTTPS_PROXY",
		"HTTP_PROXY",
		"NO_PROXY",
		"SSL_CERT_FILE",
		"NODE_EXTRA_CA_CERTS",
	]) {
		if (process.env[key]) result[key] = process.env[key];
	}
	return result;
}
