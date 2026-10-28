// Bundles the API and @tender/core (TypeScript source + data JSON) into dist/server.js.
// npm packages stay external and are installed in the image with `npm ci --omit=dev`.
import path from "node:path";
import { build } from "esbuild";

const CORE = path.resolve(import.meta.dirname, "../../packages/core/src/lib");

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  packages: "external",
  // @tender/core is a workspace package of TypeScript source: bundle it rather than leave it external.
  plugins: [
    {
      name: "bundle-core",
      setup(b) {
        b.onResolve({ filter: /^@tender\/core\// }, (args) => ({
          path: path.join(CORE, `${args.path.slice("@tender/core/".length)}.ts`),
        }));
      },
    },
  ],
});
console.log("built dist/server.js");
