// Build script for the Shravelle Browser SDK.
// Produces minified, bundled distributions so the published package and the
// browser-served script are optimized and not shipped as readable source.
//
//   npm run build
//
// Outputs:
//   shravelle-browser.min.js        standalone IIFE for <script src=...> (served at /sdk/)
//   dist/shravelle-browser.min.js   minified ESM for bundlers / npm
//   dist/react.min.js               minified ESM React integration (react is external)
//   dist/angular.min.js             minified ESM Angular integration (@angular/core is external)
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));
const banner = { js: `/*! Shravelle Browser SDK v${pkg.version} | (c) Shravelle | MIT | https://shravelle.com */` };
const common = { bundle: true, minify: true, legalComments: "none", banner, logLevel: "info" };

await build({ ...common, entryPoints: ["shravelle-browser.js"], outfile: "shravelle-browser.min.js", format: "iife", target: ["es2017"] });
await build({ ...common, entryPoints: ["shravelle-browser.js"], outfile: "dist/shravelle-browser.min.js", format: "esm", target: ["es2019"] });
await build({ ...common, entryPoints: ["react.js"], outfile: "dist/react.min.js", format: "esm", target: ["es2019"], external: ["react"] });
await build({ ...common, entryPoints: ["angular.ts"], outfile: "dist/angular.min.js", format: "esm", target: ["es2019"], external: ["@angular/core"] });
