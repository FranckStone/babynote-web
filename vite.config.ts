import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function inlineCss(): Plugin {
  return {
    name: "inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const htmlAsset = Object.values(bundle).find(
        (item) => item.type === "asset" && item.fileName === "index.html",
      );
      if (!htmlAsset || typeof htmlAsset.source !== "string") return;

      let html = htmlAsset.source;
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type !== "asset" || !fileName.endsWith(".css")) continue;
        const css = typeof item.source === "string" ? item.source : new TextDecoder().decode(item.source);
        const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const stylesheetLink = new RegExp(
          `<link\\s+rel=["']stylesheet["'](?:\\s+crossorigin)?\\s+href=["']\\/?${escapedFileName}["']\\s*\/?>`,
        );
        html = html.replace(stylesheetLink, `<style data-inline-css>${css}</style>`);
        delete bundle[fileName];
      }
      htmlAsset.source = html;
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineCss()],
  build: {
    // 第一代 iPad Air 最高只能运行 iOS 12。显式降低语法目标，避免
    // Safari 在解析 `??` 等新语法时直接终止，最终只留下空白页面。
    target: "safari12",
    outDir: "dist/client",
  },
});
