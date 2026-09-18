import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const original = readFileSync("src/app/globals.css", "utf8");
const light = {},
  dark = {};
for (const match of original.matchAll(/\.inbox-page\{([^}]+)\}/g)) {
  const values = Object.fromEntries(
    [...match[1].matchAll(/(--[\w-]+):([^;]+)(?:;|$)/g)].map((value) => [
      value[1],
      value[2],
    ]),
  );
  const isDark = original
    .slice(Math.max(0, match.index - 45), match.index)
    .includes("@media(prefers-color-scheme:dark){");
  Object.assign(isDark ? dark : light, values);
}
const variables = (values) =>
  Object.entries(values)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
// State classes mirror the actual pseudo-class rules for deterministic component-level testing.
const css = original
  .replaceAll(":hover", ".state-hover")
  .replaceAll(":focus-visible", ".state-focus")
  .replaceAll(":active", ".state-active");
const states = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "selected",
];
const content = ["light", "dark"]
  .map(
    (theme) =>
      `<section class="inbox-page" style="${variables(theme === "light" ? light : { ...light, ...dark })}"><h1>${theme} Inbox states</h1>${states.map((state) => `<div data-state="${state}"><details class="extraction-group" ${state === "selected" ? "open" : ""}><summary class="state-${state}"><strong>Reviewed</strong><span class="extraction-group-meta"><span class="extraction-group-count">22</span><span>⌄</span></span></summary></details><div class="text-import-card">${["Analyze", "Re-analyze", "Add to Calendar", "Create Task", "Ignore"].map((label, index) => `<button class="state-${state} ${index === 2 || index === 3 ? "convert-button" : ""}" ${state === "disabled" || state === "loading" ? "disabled" : ""} ${state === "loading" ? 'aria-busy="true"' : ""} ${state === "selected" ? 'aria-pressed="true"' : ""}>${state === "loading" ? "Analyzing…" : label}</button>`).join("")}</div></div>`).join("")}</section>`,
  )
  .join("");
createServer((request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(
    `<!doctype html><html><head><title>Inbox contrast fixtures</title><style>${css}body{padding:20px}.inbox-page{padding:20px;margin:16px;background:var(--surface-primary)}button{margin:6px}</style></head><body>${content}</body></html>`,
  );
}).listen(3217, "127.0.0.1", () =>
  console.log("Inbox contrast component fixtures: http://127.0.0.1:3217"),
);
