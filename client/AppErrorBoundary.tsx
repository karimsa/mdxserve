import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryState = { error: Error | null; componentStack: string | null };

/**
 * The last resort around the whole app: an error nothing else caught would otherwise unmount
 * everything and leave a blank page. Shows the error, so it can be reported, and a way back.
 * Plain elements and inline layout only, since whatever threw may be part of the shell.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
	state: AppErrorBoundaryState = { error: null, componentStack: null };

	static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
		return { error };
	}

	componentDidCatch(_: Error, errorInfo: ErrorInfo) {
		this.setState({ componentStack: errorInfo.componentStack ?? null });
	}

	render() {
		const { error, componentStack } = this.state;
		if (!error) return this.props.children;
		const details = [`${error.name}: ${error.message}`, error.stack, componentStack?.trim()]
			.filter(Boolean)
			.join("\n\n");
		return (
			<div
				role="alert"
				className="mx-auto flex max-w-3xl flex-col items-start gap-4 p-6 text-text-body"
			>
				<h1 className="m-0 text-lg font-semibold text-text-heading">Something went wrong</h1>
				<p className="m-0 text-sm">
					mdxserve hit an error it could not recover from. Your files are unchanged. Reload the page
					to continue.
				</p>
				<button
					type="button"
					onClick={() => location.reload()}
					className="h-9 cursor-pointer rounded border-0 bg-surface-accent px-4 text-sm font-semibold text-text-inverse"
				>
					Reload
				</button>
				<pre className="m-0 w-full overflow-x-auto whitespace-pre-wrap break-words rounded border border-border-default bg-surface-sunken p-3 font-mono text-xs select-text">
					{details}
				</pre>
			</div>
		);
	}
}
