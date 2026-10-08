import {
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type Dispatch,
	type SetStateAction,
} from "react";
import { DocContext } from "../DocContext";
import {
	blockStateKey,
	browserBlockStorage,
	restoreBlockState,
	saveBlockState,
	serializeBlockState,
	type BlockStateSchema,
	type BlockStateScope,
} from "./storage";

export interface BlockStateOptions<State> {
	schema: BlockStateSchema<State>;
	persist?: boolean;
	initialState: () => State;
	normalize?: (state: State) => State;
	legacyKeys?: (scope: BlockStateScope) => readonly string[];
}

interface StateSnapshot<State> {
	key: string;
	value: State;
	loaded: boolean;
}

/** Standalone exports use their page path; SSR never touches browser globals. */
export function useDocumentBlockScope(
	block: Omit<BlockStateScope, "documentPath">,
): BlockStateScope {
	const context = useContext(DocContext);
	const documentPath = context?.path ?? (typeof location === "undefined" ? "" : location.pathname);

	return { ...block, documentPath };
}

/** Persist JSON-compatible block state after hydration, isolated by document and block identity. */
export function useBlockState<State>(
	scope: BlockStateScope,
	options: BlockStateOptions<State>,
): readonly [State, Dispatch<SetStateAction<State>>] {
	const key = JSON.stringify([blockStateKey(scope), options.persist !== false]);
	const latest = useRef({ scope, options, key });
	latest.current = { scope, options, key };

	const [snapshot, setSnapshot] = useState<StateSnapshot<State>>(() => ({
		key,
		value: options.initialState(),
		loaded: false,
	}));

	// A scope change must not expose or persist the previous document's state while loading.
	const current =
		snapshot.key === key ? snapshot : { key, value: options.initialState(), loaded: false };
	const normalized = options.normalize ? options.normalize(current.value) : current.value;

	useEffect(() => {
		const { scope: currentScope, options: currentOptions } = latest.current;
		if (latest.current.key !== key) return;

		const restored =
			currentOptions.persist === false
				? undefined
				: restoreBlockState(
						browserBlockStorage(),
						currentScope,
						currentOptions.schema,
						currentOptions.legacyKeys?.(currentScope),
					);

		setSnapshot({
			key,
			value: restored === undefined ? currentOptions.initialState() : restored,
			loaded: true,
		});
	}, [key]);

	useEffect(() => {
		if (!current.loaded || latest.current.key !== key) return;

		// Commit reconciliation so removed preferences cannot return on later schema edits.
		setSnapshot((previous) => {
			if (
				previous.key !== key ||
				serializeBlockState(previous.value) === serializeBlockState(normalized)
			)
				return previous;
			return { ...previous, value: normalized };
		});
		if (latest.current.options.persist !== false)
			saveBlockState(browserBlockStorage(), latest.current.scope, normalized);
	}, [key, current.loaded, normalized]);

	const setState = useCallback<Dispatch<SetStateAction<State>>>(
		(update) => {
			setSnapshot((previous) => {
				if (latest.current.key !== key) return previous;

				const currentOptions = latest.current.options;
				const value = previous.key === key ? previous.value : currentOptions.initialState();
				const reconciled = currentOptions.normalize ? currentOptions.normalize(value) : value;
				const next =
					typeof update === "function" ? (update as (state: State) => State)(reconciled) : update;

				return { key, value: next, loaded: previous.key === key && previous.loaded };
			});
		},
		[key],
	);

	return [normalized, setState];
}
