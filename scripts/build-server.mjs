import { build } from "esbuild";
import { cpSync } from "node:fs";

// ws has optional native accelerators; the bundled JavaScript implementation is portable.
await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});

cpSync("migrations", "dist/migrations", { recursive: true });
