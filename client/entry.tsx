import { createRoot, type Root } from "react-dom/client";
import { MDXProvider } from "@mdx-js/react";
import { Figure, Pre } from "./CodeBlock";

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <p className="mb-2 font-semibold">Failed to render this page</p>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs">{message}</pre>
    </div>
  );
}

async function main() {
  const rootEl = document.getElementById("root");
  if (!rootEl) return;

  // Reuse the root across HMR re-executions of this module (self-accepting
  // below) instead of calling createRoot twice on the same container.
  const w = window as Window & { __mdxserveRoot?: Root };
  const root = (w.__mdxserveRoot ??= createRoot(rootEl));
  const file = rootEl.dataset.file;

  if (!file) {
    root.render(<ErrorBox message="No file specified." />);
    return;
  }

  try {
    const mod = await import(/* @vite-ignore */ file);
    const Content = mod.default;
    if (!Content) {
      root.render(<ErrorBox message={`${file} has no default export.`} />);
      return;
    }
    root.render(
      <MDXProvider components={{ pre: Pre, figure: Figure }}>
        <article className="prose prose-neutral dark:prose-invert max-w-none">
          <Content />
        </article>
      </MDXProvider>
    );
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    root.render(<ErrorBox message={message} />);
  }
}

main();

if (import.meta.hot) {
  import.meta.hot.accept();
}
