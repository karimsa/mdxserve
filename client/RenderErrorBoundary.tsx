import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorBox } from "./ErrorBox";

type RenderErrorBoundaryState = {
	error: Error | null;
	componentStack: string | null;
};

/**
 * Catches render-time throws from the MDX document component (e.g. a bare
 * identifier that escaped a template literal inside an inline code span) and
 * shows ErrorBox instead of leaving the page blank. React error boundaries
 * only work as class components — there is no hook equivalent.
 *
 * The parent keys this component on the cached module's identity, so an HMR
 * re-import after a fix remounts the boundary and clears the stale error
 * rather than getting stuck on the first throw.
 */
export class RenderErrorBoundary extends Component<
	{ children: ReactNode },
	RenderErrorBoundaryState
> {
	state: RenderErrorBoundaryState = { error: null, componentStack: null };

	static getDerivedStateFromError(error: Error): Partial<RenderErrorBoundaryState> {
		return { error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		this.setState({ componentStack: errorInfo.componentStack ?? null });
	}

	render() {
		const { error, componentStack } = this.state;
		if (!error) return this.props.children;

		const message = componentStack ? `${error.message}\n${componentStack.trim()}` : error.message;
		return <ErrorBox message={message} />;
	}
}
