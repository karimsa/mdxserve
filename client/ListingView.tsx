import { motion } from "framer-motion";
import { stagger } from "./motion";
import type { ListingEntry, Route } from "./router";

function FolderIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-[18px] w-[18px] shrink-0 text-gray-400"
      aria-hidden="true"
    >
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h4.379a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 11.12 5H16.5A1.5 1.5 0 0 1 18 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 15.5v-11Z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-[18px] w-[18px] shrink-0 text-gray-400"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4 2a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 4 18h12a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.878 2H4Zm7 1.5v3a1 1 0 0 0 1 1h3l-4-4Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const rowVariants = {
  initial: { opacity: 0, y: 4 },
  enter: { opacity: 1, y: 0 },
};

function Row({
  href,
  icon,
  label,
  muted,
  size,
}: {
  href: string | null;
  icon: "folder" | "file";
  label: string;
  muted: boolean;
  size?: number;
}) {
  const inner = (
    <>
      {icon === "folder" ? <FolderIcon /> : <FileIcon />}
      <span className="truncate">{label}</span>
      {typeof size === "number" ? (
        <span className="ml-auto pl-4 text-xs text-gray-400 dark:text-gray-500 tabular-nums">{formatSize(size)}</span>
      ) : null}
    </>
  );

  if (muted || !href) {
    return (
      <motion.div
        variants={rowVariants}
        className="flex items-center gap-2 px-3 py-2 text-gray-400 dark:text-gray-600 cursor-default"
      >
        {inner}
      </motion.div>
    );
  }

  // Plain <a>: the router's global click delegation (client/router.ts) intercepts
  // this for client-side navigation; no per-row handler needed.
  return (
    <motion.a
      variants={rowVariants}
      href={href}
      className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-white/5"
    >
      {inner}
    </motion.a>
  );
}

export function ListingView({ route }: { route: Extract<Route, { kind: "listing" }> }) {
  const { path, entries } = route;
  const segments = path.split("/").filter(Boolean);
  const parentSegments = segments.slice(0, -1);
  const parentHref = parentSegments.length ? `/${parentSegments.join("/")}/` : "/";

  return (
    <motion.div
      variants={stagger}
      initial="initial"
      animate="enter"
      className="divide-y divide-gray-100 dark:divide-white/10 border-y border-gray-100 dark:border-white/10"
    >
      {path !== "/" ? <Row href={parentHref} icon="folder" label=".." muted={false} /> : null}
      {entries.map((entry: ListingEntry) => {
        const href = `${path}${entry.name}${entry.isDir ? "/" : ""}`;
        if (entry.isDir) {
          return <Row key={entry.name} href={href} icon="folder" label={entry.name} muted={false} />;
        }
        if (entry.isDoc) {
          return <Row key={entry.name} href={href} icon="file" label={entry.name} muted={false} size={entry.size} />;
        }
        return <Row key={entry.name} href={null} icon="file" label={entry.name} muted size={entry.size} />;
      })}
    </motion.div>
  );
}
