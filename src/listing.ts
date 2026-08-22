import fs from "node:fs";
import path from "node:path";
import { renderDocument, escapeHtml } from "./html.js";

const FOLDER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-[18px] w-[18px] shrink-0 text-gray-400"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h4.379a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 11.12 5H16.5A1.5 1.5 0 0 1 18 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 15.5v-11Z" /></svg>`;

const FILE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-[18px] w-[18px] shrink-0 text-gray-400"><path fill-rule="evenodd" d="M4 2a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 4 18h12a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.878 2H4Zm7 1.5v3a1 1 0 0 0 1 1h3l-4-4Z" clip-rule="evenodd" /></svg>`;

const IGNORED_NAMES = new Set(["node_modules"]);

interface Entry {
  name: string;
  isDir: boolean;
  isDoc: boolean;
  size?: number;
}

function isServable(name: string): boolean {
  if (name.startsWith(".")) return false;
  if (IGNORED_NAMES.has(name)) return false;
  return true;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function row(options: { href: string | null; icon: string; label: string; muted: boolean; size?: number }): string {
  const { href, icon, label, muted, size } = options;
  const sizeLabel =
    typeof size === "number"
      ? `<span class="ml-auto pl-4 text-xs text-gray-400 dark:text-gray-500 tabular-nums">${formatSize(size)}</span>`
      : "";
  const inner = `${icon}<span class="truncate">${escapeHtml(label)}</span>${sizeLabel}`;

  if (muted || !href) {
    return `<div class="flex items-center gap-2 px-3 py-2 text-gray-400 dark:text-gray-600 cursor-default">${inner}</div>`;
  }
  return `<a href="${escapeHtml(href)}" class="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-white/5">${inner}</a>`;
}

/**
 * Render a directory listing page for `urlPath` (root-relative, e.g. "/" or
 * "/sub/") within the served directory `root`.
 */
export function renderListing(root: string, urlPath: string): string {
  const normalized = urlPath.endsWith("/") ? urlPath : `${urlPath}/`;
  const dirFsPath = path.join(root, normalized);

  const dirents = fs.readdirSync(dirFsPath, { withFileTypes: true });

  const entries: Entry[] = dirents
    .filter((d) => isServable(d.name))
    .map((d) => {
      const isDir = d.isDirectory();
      const ext = path.extname(d.name).toLowerCase();
      const isDoc = !isDir && (ext === ".md" || ext === ".mdx");
      let size: number | undefined;
      if (!isDir) {
        try {
          size = fs.statSync(path.join(dirFsPath, d.name)).size;
        } catch {
          size = undefined;
        }
      }
      return { name: d.name, isDir, isDoc, size };
    })
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

  const segments = normalized.split("/").filter(Boolean);
  const rootName = path.basename(root) || root;

  let breadcrumb = `<a href="/" class="text-gray-500 dark:text-gray-400 hover:text-gray-950 dark:hover:text-white">${escapeHtml(rootName)}</a>`;
  let acc = "";
  for (const seg of segments) {
    acc += `/${seg}`;
    breadcrumb += ` <span class="text-gray-300 dark:text-gray-700">/</span> <a href="${escapeHtml(acc)}/" class="text-gray-500 dark:text-gray-400 hover:text-gray-950 dark:hover:text-white">${escapeHtml(seg)}</a>`;
  }

  const rows: string[] = [];

  if (normalized !== "/") {
    const parent = segments.slice(0, -1).join("/");
    const parentHref = parent ? `/${parent}/` : "/";
    rows.push(row({ href: parentHref, icon: FOLDER_ICON, label: "..", muted: false }));
  }

  for (const entry of entries) {
    const href = `${normalized}${entry.name}${entry.isDir ? "/" : ""}`;
    if (entry.isDir) {
      rows.push(row({ href, icon: FOLDER_ICON, label: entry.name, muted: false }));
    } else if (entry.isDoc) {
      rows.push(row({ href, icon: FILE_ICON, label: entry.name, muted: false, size: entry.size }));
    } else {
      rows.push(row({ href: null, icon: FILE_ICON, label: entry.name, muted: true, size: entry.size }));
    }
  }

  const body = `    <div class="mx-auto max-w-3xl px-6 py-16">
      <h1 class="mb-6 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">${breadcrumb}</h1>
      <div class="divide-y divide-gray-100 dark:divide-white/10 border-t border-b border-gray-100 dark:border-white/10">
        ${rows.join("\n        ")}
      </div>
    </div>`;

  return renderDocument({ title: `${rootName}${normalized}`, body });
}
