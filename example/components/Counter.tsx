import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="not-prose flex items-center gap-3 my-4">
      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        className="rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Count: {count}
      </button>
      <span className="text-sm text-neutral-500 dark:text-neutral-400">
        Click to increment
      </span>
    </div>
  );
}
