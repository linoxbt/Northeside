// Bundles worker/ops-worker.ts (and the workspace packages it imports) into one self-contained
// ES module at netlify/functions/ops-worker.mjs. Netlify's own function bundler does not inline
// TypeScript workspace packages, so the build does it first. Runs as part of `pnpm build`.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await build({
  entryPoints: [`${root}/worker/ops-worker.ts`],
  outfile: `${root}/netlify/functions/ops-worker.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  legalComments: "none",
  // CommonJS dependencies (postgres, web-push) call require() for Node built-ins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
console.log("bundled netlify/functions/ops-worker.mjs");
