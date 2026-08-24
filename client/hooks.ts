import { useEffect, useState } from "react";

/** Returns `value`, updated only after it has stayed unchanged for `delayMs`. */
export function useDebounced<Value>(value: Value, delayMs: number): Value {
	const [debouncedValue, setDebouncedValue] = useState(value);

	useEffect(() => {
		const handle = setTimeout(() => setDebouncedValue(value), delayMs);
		return () => clearTimeout(handle);
	}, [value, delayMs]);

	return debouncedValue;
}
