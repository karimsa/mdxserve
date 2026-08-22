import type { ReactNode } from 'react';

type CalloutType = 'info' | 'warn';

interface CalloutProps {
  type?: CalloutType;
  children: ReactNode;
}

const styles: Record<CalloutType, { bg: string; icon: string }> = {
  info: {
    bg: 'bg-sky-50 text-sky-900 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/20',
    icon: '💡',
  },
  warn: {
    bg: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/20',
    icon: '⚠️',
  },
};

export default function Callout({ type = 'info', children }: CalloutProps) {
  const { bg, icon } = styles[type];

  return (
    <div className={`not-prose flex items-start gap-3 rounded-lg p-4 my-4 ${bg}`}>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm leading-5">{children}</div>
    </div>
  );
}
