import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorBox } from "./ErrorBox";

type RenderErrorBoundaryState = {
	error: Error | null;
	componentStack: string | null;
	/** The `resetKey` this state belongs to. */
	resetKey: unknown;
};

/**
 * Catches a render-time throw from a builtin (a fault in its own code for
 * props the document validated) and shows ErrorBox in its place instead of
 * leaving the page blank. React error boundaries only work as class
 * components — there is no hook equivalent.
 *
 * The parent passes the node it renders as `resetKey`: a refetch that changes
 * the node hands over a new object, which clears the stale error rather than
 * getting stuck on the first throw. It is a prop and not a React `key`, which
 * would remount the builtin and drop its state.
 */
export class RenderErrorBoundary extends Component<
	{ resetKey: unknown; children: ReactNode },
	RenderErrorBoundaryState
> {
	state: RenderErrorBoundaryState = {
		error: null,
		componentStack: null,
		resetKey: this.props.resetKey,
	};

	static getDerivedStateFromProps(
		props: { resetKey: unknown },
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
