# Document block state

Use this area for local preferences belonging to a block on a document page. App-wide
preferences (theme, sidebar, listing order) have different scopes and stay in their own modules.

```tsx
const scope = useDocumentBlockScope({ kind: "chart", version: 1, blockId: id });
const [state, setState] = useBlockState(scope, {
	schema: chartStateSchema,
	initialState: initialChartState,
	normalize: (saved) => reconcileChartState(saved, series),
});
```

Import the hooks from `./useBlockState` and storage helpers/types from `./storage`.

- Keep `blockId` stable across edits and unique within the document. `kind` separates component
  families; `version` identifies the persisted format. The scope uses `DocContext.path`, with the
  browser pathname as a fallback for standalone pages.
- Provide a schema with `safeParse` (Zod schemas work), a fresh default-state factory, and optional
  pure normalization against current block props. State must be JSON-compatible. Validation
  checks saved data; normalization handles changes to the block's current content or schema.
- Server rendering and initial hydration use defaults. Storage is restored in an effect before
  any state is saved. Changing scope loads that scope's preferences without exposing or saving
  the old scope's state under the new key. The setter supports React-style functional updates.
- Invalid saved data, blocked storage, and quota errors fall back to usable in-memory state.
  Normalization runs before rendering and saving and is committed to memory, so removed
  preferences do not reappear on later content edits. It may return a fresh object.
- For migrations, provide `legacyKeys(scope)`. Only a missing current key permits legacy reads;
  a corrupt current value does not resurrect older preferences. Successful restoration is saved
  under the new key. Legacy keys are left intact for compatibility with older app versions.
- Use `blockStateKey(scope)` as a React key if transient UI state (open menus, focused cells)
  should also reset when the scope changes. Persistence itself does not require a remount.

`restoreBlockState` and `saveBlockState` accept a small storage interface for direct use and
contract tests. They contain no component-specific knowledge. `useTableState` supplies table
validation, column reconciliation, and the old table-key migration as one consumer of this API.
