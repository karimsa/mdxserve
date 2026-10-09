import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Settings } from "../Settings";
import { trpcClient } from "../api";
export type AgentChoice = "codex" | "claude" | "disabled";
export function DiagramPreferences({
	onClose,
	canEditDiagrams = true,
}: {
	onClose: () => void;
	canEditDiagrams?: boolean;
}) {
	return canEditDiagrams ? <DiagramSettings onClose={onClose} /> : <Settings onClose={onClose} />;
}

function DiagramSettings({ onClose }: { onClose: () => void }) {
	const [agent, setAgent] = useState<AgentChoice>("disabled");
	const [models, setModels] = useState({ codex: "", claude: "" });
	const [catalog, setCatalog] = useState<{ id: string; label: string }[]>([]);
	const [loadingModels, setLoadingModels] = useState(false);
	const [modelError, setModelError] = useState("");
	const [refreshModels, setRefreshModels] = useState(0);
	const [statuses, setStatuses] = useState("Agents haven’t been checked yet.");
	const [error, setError] = useState("");
	const [pending, setPending] = useState(true);
	const [checking, setChecking] = useState(false);
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
		void trpcClient.getDiagramPreferences
			.query({})
			.then((result) => {
				setAgent(result.agent);
				setModels(result.models);
				setLoaded(true);
			})
			.catch((failure) => setError(failure.message))
			.finally(() => setPending(false));
	}, []);
	useEffect(() => {
		let obsolete = false;
		setCatalog([]);
		setModelError("");
		if (!loaded || agent === "disabled") {
			setLoadingModels(false);
			return;
		}
		setLoadingModels(true);
		void trpcClient.listDiagramModels
			.mutate({ provider: agent })
			.then((result) => {
				if (!obsolete) setCatalog(result);
			})
			.catch(() => {
				if (!obsolete) setModelError("Couldn’t load models. Your saved choice is unchanged.");
			})
			.finally(() => {
				if (!obsolete) setLoadingModels(false);
			});
		return () => {
			obsolete = true;
		};
	}, [agent, loaded, refreshModels]);
	async function save(nextAgent: AgentChoice, nextModels = models) {
		const previousAgent = agent;
		const previousModels = models;
		setAgent(nextAgent);
		setModels(nextModels);
		setPending(true);
		setError("");
		try {
			await trpcClient.setDiagramPreferences.mutate({ agent: nextAgent, models: nextModels });
			window.dispatchEvent(new Event("mdxserve-diagram-preferences"));
		} catch {
			setAgent(previousAgent);
			setModels(previousModels);
			setError("Couldn’t save settings. Your previous settings are unchanged. Try again.");
		} finally {
			setPending(false);
		}
	}

	return (
		<Settings
			onClose={onClose}
			saving={(loaded && pending) || checking}
			status={
				error ? (
					<p role="alert" className="diagram-error">
						{error}
					</p>
				) : (
					<span role="status">
						{pending ? (loaded ? "Saving…" : "Loading settings…") : "Settings save automatically."}
					</span>
				)
			}
			diagrams={
				<section>
					<h3>Diagram generation</h3>
					<p>Turn descriptions and images into editable Mermaid.</p>
					<label className="diagram-setting-row" htmlFor="diagram-agent">
						<span>
							<strong>Default agent</strong>
							<small>Use an installed, signed-in CLI.</small>
						</span>
						<span className="diagram-agent-select">
							<select
								id="diagram-agent"
								value={agent}
								onChange={(event) => void save(event.target.value as AgentChoice)}
								disabled={!loaded || pending || checking}
							>
								<option value="codex">Codex</option>
								<option value="claude">Claude Code</option>
								<option value="disabled">Disabled</option>
							</select>
							<ChevronDown size={14} aria-hidden="true" />
						</span>
					</label>
					<p className="diagram-setting-note">
						Auto detect selects an installed, signed-in agent for every conversion.
					</p>
					{agent !== "disabled" && (
						<>
							<label className="diagram-setting-row" htmlFor="diagram-model">
								<span>
									<strong>Model</strong>
									<small>{agent === "codex" ? "Codex" : "Claude Code"} model for diagrams.</small>
								</span>
								<span className="diagram-agent-select diagram-model-select">
									<select
										id="diagram-model"
										aria-label="Model"
										value={models[agent]}
										disabled={!loaded || loadingModels || pending || checking}
										onChange={(event) =>
											void save(agent, { ...models, [agent]: event.target.value })
										}
									>
										{!catalog.some((model) => model.id === models[agent]) && (
											<option value={models[agent]}>
												{models[agent]}
												{loadingModels ? "" : " (saved)"}
											</option>
										)}
										{catalog.map((model) => (
											<option key={model.id} value={model.id}>
												{model.label}
											</option>
										))}
									</select>
									<ChevronDown size={14} aria-hidden="true" />
								</span>
							</label>
							<div className="diagram-model-status">
								<small role="status">
									{loadingModels
										? "Loading models from CLI…"
										: modelError || "Models from your installed CLI."}
								</small>
								<button
									type="button"
									disabled={loadingModels}
									onClick={() => setRefreshModels((value) => value + 1)}
								>
									Refresh models
								</button>
							</div>
						</>
					)}
					<div className="diagram-agent-status">
						<span role="status">{statuses}</span>
						<button
							type="button"
							disabled={checking || pending || !loaded}
							onClick={async () => {
								setChecking(true);
								setStatuses("Checking agents…");
								try {
									const result = await trpcClient.probeDiagramAgents.mutate({});
									const ready = result.filter((status) => status.state === "ready");
									await save(
										ready.find((status) => status.provider === agent)?.provider ??
											ready[0]?.provider ??
											"disabled",
									);
									setStatuses(
										result
											.map(
												(status) =>
													`${status.provider === "codex" ? "Codex" : "Claude Code"}: ${status.state}`,
											)
											.join(" · "),
									);
								} catch {
									setStatuses("Could not check agents");
								} finally {
									setChecking(false);
								}
							}}
						>
							Auto detect
						</button>
					</div>
					<p className="diagram-settings-disclosure">
						Text and images are sent to the selected provider using your account. Disabled stops
						conversion; existing diagrams still render.
					</p>
				</section>
			}
		/>
	);
}
