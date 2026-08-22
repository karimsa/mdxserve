import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { fadeRise } from "../motion";

export const calloutProps = z.object({
  type: z.enum(["info", "warn"]).default("info").describe("Visual intent: info (sky) or warn (amber)."),
  title: z.string().optional().describe("Optional bold heading shown above the body."),
  children: z.custom<ReactNode>().describe("Callout body; any MDX/Markdown content."),
});

export type CalloutProps = z.infer<typeof calloutProps>;

const styles: Record<"info" | "warn", { bg: string; icon: string }> = {
  info: {
    bg: "bg-sky-50 text-sky-900 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/20",
    icon: "💡",
  },
  warn: {
    bg: "bg-amber-50 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/20",
    icon: "⚠️",
  },
};

export default function Callout({ type = "info", title, children }: CalloutProps) {
  const { bg, icon } = styles[type];

  return (
    <motion.div
      variants={fadeRise}
      initial="initial"
      animate="enter"
      className={`not-prose flex items-start gap-3 rounded-lg p-4 my-4 ${bg}`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm leading-5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
      </div>
    </motion.div>
  );
}
