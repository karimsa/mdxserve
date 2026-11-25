import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorBox } from "./ErrorBox";

type RenderErrorBoundaryState = {
	error: Error | null;
	componentStack: string | null;
	/** The `resetKey` this state belongs to. */
	resetKey: number;
};

/**
 * Catches render-time throws from the MDX document component (e.g. a bare
 * identifier that escaped a template literal inside an inline code span) and
 * shows ErrorBox instead of leaving the page blank. React error boundaries
 * only work as class components — there is no hook equivalent.
 *
 * The parent passes the cached module's identity as `resetKey`, so an HMR
 * re-import after a fix clears the stale error rather than getting stuck on
 * the first throw. It is a prop and not a React `key`: a key would remount the
 * whole article on every re-import, error or not.
 */
export class RenderErrorBoundary extends Component<
	{ resetKey: number; children: ReactNode },
	RenderErrorBoundaryState
> {
	state: RenderErrorBoundaryState = {
		error: null,
		componentStack: null,
		resetKey: this.props.resetKey,
	};

	static getDerivedStateFromProps(
		props: { resetKey: number },
		state: RenderErrorBoundaryState,
	): RenderErrorBoundaryState | null {
		if (props.resetKey === state.resetKey) return null;
		return { error: null, componentStack: null, resetKey: props.resetKey };
	}

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
