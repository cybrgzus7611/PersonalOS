// Static guardrails for the frontend (run by `npm run check`). Fails when public/:
// - calls fetch() anywhere but public/js/api.js (all server calls go through one module),
// - writes HTML from strings (innerHTML, outerHTML, insertAdjacentHTML, document.write),
// - loads anything from another origin (http:// or https:// URLs; no CDNs, fonts or analytics),
// - uses inline event handlers or inline scripts in HTML (the milestone D CSP forbids them).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "public";
const ALLOWED_URLS = ["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xhtml"];
const problems = [];
// Until the M2 frontend adds public/js/api.js, the M1 placeholder page may fetch /api/health directly.
const placeholder = !existsSync("public/js/api.js");

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else check(path);
  }
}

function stripComments(text, ext) {
  if (ext === "html") return text.replace(/<!--[\s\S]*?-->/g, "");
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function check(path) {
  const ext = path.split(".").pop();
  if (!["js", "mjs", "html", "css"].includes(ext)) return;
  const rel = relative(".", path).replaceAll("\\", "/");
  const lines = stripComments(readFileSync(path, "utf8"), ext).split("\n");
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (ext !== "css" && /\bfetch\s*\(/.test(line) && rel !== "public/js/api.js" && !(placeholder && rel === "public/js/main.js")) problems.push(`${at} calls fetch() outside public/js/api.js`);
    if (/\b(innerHTML|outerHTML)\s*[+]?=|insertAdjacentHTML\s*\(|document\.write\s*\(/.test(line)) problems.push(`${at} builds HTML from a string; use textContent and DOM nodes`);
    for (const url of line.match(/https?:\/\/[^\s"'`)<>]+/g) ?? []) {
      if (!ALLOWED_URLS.some((ok) => url.startsWith(ok))) problems.push(`${at} references another origin: ${url}`);
    }
    if (ext === "html" && /\son[a-z]+\s*=/.test(line)) problems.push(`${at} has an inline event handler`);
    if (ext === "html" && /<script(?![^>]*\bsrc=)[^>]*>/.test(line)) problems.push(`${at} has an inline <script>`);
  });
}

walk(ROOT);
if (problems.length) {
  console.error(`check:public found ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("check:public ok");
