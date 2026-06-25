// Cross-platform locale copy for the bot build.
// Replaces the previous Unix-only mkdir -p && cp -r, which broke on
// Windows / non-bash shells. Uses Node fs.cpSync (Node >=16.7).
const { cpSync, mkdirSync, existsSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

const src = resolve(__dirname, "..", "src", "i18n", "locales");
const dest = resolve(__dirname, "..", "dist", "i18n", "locales");

if (!existsSync(src)) {
  console.error("[copy-locales] source locales dir missing:", src);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[copy-locales] copied locales ->", dest);
