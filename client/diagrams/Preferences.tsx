import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { ChevronDown, Network, Settings, X } from "lucide-react";
import { trpcClient } from "../api";
export type AgentChoice = "codex" | "claude" | "disabled";
export function DiagramPreferences({ onClose }: { onClose: () => void }) {
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
	async function save() {
		setPending(true);
		setError("");
		try {
			await trpcClient.setDiagramPreferences.mutate({ agent, models });
			window.dispatchEvent(new Event("mdxserve-diagram-preferences"));
			onClose();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Could not save");
		} finally {
			setPending(false);
		}
	}
	return (
		<Modal
			open
			onClose={onClose}
			className="diagram-dialog diagram-settings"
			aria-label="Settings"
		>
			<header className="diagram-navbar">
				<div className="diagram-title">
					<Settings size={17} />
					<h2>Settings</h2>
				</div>
				<button
					type="button"
					className="diagram-icon-button"
					aria-label="Close settings"
					onClick={onClose}
				>
					<X size={18} />
				</button>
			</header>
			<div className="diagram-settings-body">
				<aside>
					<span className="diagram-settings-category">
						<Network size={15} />
						Diagrams
					</span>
				</aside>
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
								onChange={(event) => setAgent(event.target.value as AgentChoice)}
								disabled={!loaded}
							>
								<option value="codex">Codex</option>
								<option value="claude">Claude Code</option>
								<option value="disabled">Disabled</option>
							</select>
							<ChevronDown size={14} aria-hidden="true" />
						</span>
					</label>
					<p className="diagram-setting-note">
						Auto detect selects an installed, signed-in agent. Save to use that choice for every
						conversion.
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
										disabled={!loaded || loadingModels}
										onChange={(event) => setModels({ ...models, [agent]: event.target.value })}
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
									setAgent(
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
					<p role="alert" className="diagram-error">
						{error}
					</p>
				</section>
			</div>
			<footer className="diagram-settings-footer">
				<span>
					Also available through <code>mdxserve setup</code>
				</span>
				<button
					type="button"
					className="diagram-primary"
					disabled={pending || checking || !loaded}
					onClick={() => void save()}
				>
					Save settings
				</button>
			</footer>
		</Modal>
	);
}
