import path from "node:path";
import { createRequire } from "node:module";
import type { Server as HttpServer } from "node:http";
import { createServer as createViteServer, type PluginOption, type ViteDevServer } from "vite";
import mdx from "@mdx-js/rollup";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import remarkGfm from "remark-gfm";
import rehypePrettyCode from "rehype-pretty-code";
import { getPackageRoot } from "./pkg.js";
import { tailwindPlusTheme } from "./shiki-theme.js";

const require = createRequire(import.meta.url);

function resolveFromPkg(specifier: string): string {
  return require.resolve(specifier, { paths: [getPackageRoot()] });
}

export interface CreateDevServerOptions {
  root: string;
  httpServer: HttpServer;
  extraFsAllow?: string[];
}

export async function createDevServer(options: CreateDevServerOptions): Promise<ViteDevServer> {
  const { root, httpServer, extraFsAllow = [] } = options;
  const pkgRoot = getPackageRoot();

  const reactEntry = resolveFromPkg("react");
  const reactDomEntry = resolveFromPkg("react-dom");
  const reactDomClientEntry = resolveFromPkg("react-dom/client");
  const jsxRuntime = resolveFromPkg("react/jsx-runtime");
  const jsxDevRuntime = resolveFromPkg("react/jsx-dev-runtime");
  const mdxReactEntry = resolveFromPkg("@mdx-js/react");
  const mermaidEntry = resolveFromPkg("mermaid");
  const zodEntry = resolveFromPkg("zod");

  // @mdx-js/rollup must run before @vitejs/plugin-react so that .mdx/.md
  // files are compiled to JSX before the react plugin's babel transform.
  const mdxPlugin = {
    ...mdx({
      remarkPlugins: [remarkGfm],
      rehypePlugins: [
        [
          rehypePrettyCode,
          {
            theme: tailwindPlusTheme,
            keepBackground: false,
          },
        ],
      ],
      providerImportSource: "@mdx-js/react",
    }),
    enforce: "pre" as const,
  };

  const plugins: PluginOption[] = [
    mdxPlugin,
    react({ include: /\.(mdx|md|jsx|tsx|js|ts)$/ }),
    tailwindcss(),
  ];

  const vite = await createViteServer({
    root,
    configFile: false,
    logLevel: "warn",
    appType: "custom",
    server: {
      middlewareMode: true,
      fs: {
        allow: [root, path.join(pkgRoot, "client"), path.join(pkgRoot, "node_modules"), ...extraFsAllow],
      },
      hmr: {
        server: httpServer,
      },
    },
    plugins,
    resolve: {
      // Vite/rollup-plugin-alias matches on a "find" prefix (id === find or
      // id.startsWith(find + "/")), taking the first match in list order —
      // so subpath aliases like "react/jsx-runtime" MUST be listed before
      // the bare "react" alias, or "react" would prefix-match them first
      // and mangle the replacement (e.g. ".../react/index.js/jsx-runtime").
      alias: [
        { find: "react/jsx-runtime", replacement: jsxRuntime },
        { find: "react/jsx-dev-runtime", replacement: jsxDevRuntime },
        { find: "react-dom/client", replacement: reactDomClientEntry },
        { find: "react-dom", replacement: reactDomEntry },
        { find: "react", replacement: reactEntry },
        { find: "@mdx-js/react", replacement: mdxReactEntry },
        { find: "mermaid", replacement: mermaidEntry },
        { find: "zod", replacement: zodEntry },
      ],
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      entries: [],
      include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@mdx-js/react", "mermaid", "zod"],
    },
  });

  return vite;
}
