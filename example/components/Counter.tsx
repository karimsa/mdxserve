import { useState } from "react";

/**
 * A custom component imported by 03-custom-components.mdx. Styled with the
 * same design tokens the builtins use (`bg-surface-card`, `text-text-muted`,
 * `border-border-default`…), so it matches in both themes without any `dark:`
 * classes.
 */
export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="not-prose flex items-center gap-3">
      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        className="h-[34px] cursor-pointer rounded-md border border-border-default bg-surface-card px-3.5 font-sans text-[length:var(--size-md)] font-semibold text-text-body shadow-xs transition-colors hover:bg-surface-hover"
      >
        Count: {count}
      </button>
      <span className="font-sans text-[length:var(--size-sm)] text-text-muted">Click to increment</span>
    </div>
  );
}
