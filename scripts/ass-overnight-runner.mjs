import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    ...options,
  });
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] ?? "";
}

const promptFile = getArg("--prompt-file");
const repo = getArg("--repo");
const branchPrefix = getArg("--branch-prefix") || "ass/overnight";
const titleArg = getArg("--title");
const aiCommand = process.env.ASS_AI_CODE_COMMAND;

if (!promptFile || !existsSync(promptFile)) {
  console.error("Missing --prompt-file path.");
  process.exit(1);
}

if (!repo) {
  console.error("Missing --repo owner/name.");
  process.exit(1);
}

const prompt = readFileSync(promptFile, "utf8").trim();
if (!prompt) {
  console.error("Prompt file is empty.");
  process.exit(1);
}

const currentBranch = run("git", ["branch", "--show-current"]).trim();
if (currentBranch === "main" || currentBranch === "master") {
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12);
  const branch = `${branchPrefix}/${suffix}`;
  run("git", ["switch", "-c", branch], { stdio: "inherit" });
} else {
  console.log(`Already on non-main branch: ${currentBranch}`);
}

if (!aiCommand) {
  console.log(
    "ASS_AI_CODE_COMMAND is not set, so no AI coding command was run. Set it to an approved local command such as your Claude Code command."
  );
} else {
  run(aiCommand, [prompt], { stdio: "inherit", shell: true });
}

const status = run("git", ["status", "--short"]).trim();
if (!status) {
  console.log("No file changes were produced. Leaving branch without a PR.");
  process.exit(0);
}

run("git", ["add", "--all"], { stdio: "inherit" });
run("git", ["commit", "-m", titleArg || `ASS overnight: ${basename(promptFile)}`], {
  stdio: "inherit",
});
run("git", ["push", "--set-upstream", "origin", "HEAD"], { stdio: "inherit" });

const prBody = `${prompt}

---

ASS overnight guardrails:
- This PR is draft-only.
- Do not merge into main until Kevin performs final review.
- Confirm tests, screenshots for UI changes, and secret scanning before merge.
- This workflow must not use leaked proprietary files or unauthorized third-party code.`;

run(
  "gh",
  [
    "pr",
    "create",
    "--draft",
    "--repo",
    repo,
    "--title",
    titleArg || "ASS overnight coding run",
    "--body",
    prBody,
  ],
  { stdio: "inherit" }
);
