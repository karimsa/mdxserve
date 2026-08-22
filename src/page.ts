import path from "node:path";
import { renderDocument, escapeHtml } from "./html.js";

/**
 * Render the HTML shell for an .md/.mdx page. The actual MDX rendering
 * happens client-side: the shell embeds the root-relative file path in
 * data-file and boots the client entry, which dynamic-imports the compiled
 * MDX module through Vite.
 */
export function renderPageShell(root: string, urlPath: string): string {
  const fileName = path.basename(urlPath);
  const rootName = path.basename(root) || root;
  const segments = urlPath.split("/").filter(Boolean);

  let breadcrumb = `<a href="/" class="text-gray-500 dark:text-gray-400 hover:text-gray-950 dark:hover:text-white">${escapeHtml(rootName)}</a>`;
  let acc = "";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    acc += `/${seg}`;
    const isLast = i === segments.length - 1;
    breadcrumb += ` <span class="text-gray-300 dark:text-gray-700">/</span> `;
    breadcrumb += isLast
      ? `<span>${escapeHtml(seg)}</span>`
      : `<a href="${escapeHtml(acc)}/" class="text-gray-500 dark:text-gray-400 hover:text-gray-950 dark:hover:text-white">${escapeHtml(seg)}</a>`;
  }

  const body = `    <div class="mx-auto max-w-3xl px-6 py-10">
      <div class="mb-8 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
        ${breadcrumb}
      </div>
      <div id="root" data-file="${escapeHtml(urlPath)}"></div>
    </div>
    <script type="module" src="/__mdxserve/entry.tsx"></script>`;

  return renderDocument({ title: fileName, body });
}
