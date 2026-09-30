import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * A view-only copy's app is one HTML file: pages opened straight from
 * the disk can't load scripts or styles beside them, so both go inside the page.
 */
function oneFile(): Plugin {
  return {
    name: "ancestree-copy-one-file",
    apply: "build",
    enforce: "post",
    generateBundle: {
      // Last: Vite finishes the chunks in this hook too (e.g. filling in __VITE_PRELOAD__).
      order: "post",
      handler(_, bundle) {
        const page = Object.values(bundle).find(
          (item) => item.type === "asset" && item.fileName.endsWith(".html"),
        );
        if (page?.type !== "asset") return;
        let html = String(page.source);
        for (const [name, item] of Object.entries(bundle)) {
          const file = name.split("/").pop() ?? name;
          if (item.type === "chunk") {
            // "</script" or "<!--" in the code would end or confuse the script element.
            const code = item.code
              .replaceAll("</script", "<\\/script")
              .replaceAll("<!--", "<\\!--");
            html = html.replace(
              new RegExp(`<script type="module"[^>]*src="[^"]*${file}"[^>]*></script>`),
              () => `<script type="module">${code}</script>`,
            );
            delete bundle[name];
          } else if (name.endsWith(".css")) {
            const css = String(item.source).replaceAll("</style", "<\\/style");
            html = html.replace(
              new RegExp(`<link rel="stylesheet"[^>]*href="[^"]*${file}"[^>]*>`),
              () => `<style>${css}</style>`,
            );
            delete bundle[name];
          }
        }
        if (html.includes("__VITE_PRELOAD__")) {
          this.error("The copy's app still has Vite's preload placeholders in it");
        }
        page.source = html;
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const viewer = mode === "viewer";
  return {
    plugins: [react(), tailwindcss(), ...(viewer ? [oneFile()] : [])],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    // Local only: listen on 127.0.0.1 and forward /api to the backend.
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: { "/api": "http://127.0.0.1:8000" },
    },
    preview: { host: "127.0.0.1" },
    build: viewer
      ? {
          // The copy's app (pnpm build:viewer): one file, everything inside, fonts included.
          outDir: "dist-viewer",
          emptyOutDir: true,
          assetsInlineLimit: () => true,
          cssCodeSplit: false,
          modulePreload: false,
          chunkSizeWarningLimit: 4000,
          rolldownOptions: {
            input: fileURLToPath(new URL("./viewer.html", import.meta.url)),
            output: { codeSplitting: false },
          },
        }
      : // The story editor (MDXEditor, ~590 kB) is its own chunk, loaded when a story is first
        // opened.
        { chunkSizeWarningLimit: 650 },
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
