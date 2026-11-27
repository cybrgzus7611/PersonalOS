# Start M2 frontend work in OpenCode (GLM) on Windows

For Nisa. Do these steps once PR #4 has merged into `main`. Run the commands in **PowerShell**, in the folder where you keep code.

## 1. Check the tools (once)

```powershell
git --version        # any recent Git
node --version       # must be v22.13 or later (Node 22 LTS)
opencode --version   # OpenCode, with a GLM model connected
```

If `opencode` is missing, install it with `npm install -g opencode-ai`, then run `opencode` and connect your GLM provider with the `/connect` command. The OpenCode docs cover this (opencode.ai/docs).

## 2. Get the latest code

First time:

```powershell
git clone https://github.com/cybrgzus7611/PersonalOS.git
cd PersonalOS
```

Already cloned:

```powershell
cd PersonalOS
git switch main
git pull
```

## 3. Create the frontend branch

```powershell
git switch -c fe/m2-dashboard
```

## 4. Start the backend locally (keep this window open)

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Wait for `Ready on http://localhost:8787`. Open a **second** PowerShell window in the same folder and run this once:

```powershell
npm run seed:local
npm run check
```

Expect `Seeded 5 workstreams` and then all tests passing. Open http://localhost:8787 in the browser. The M1 placeholder page says "API OK".

## 5. Start OpenCode

In the second window:

```powershell
opencode
```

Pick your GLM model and paste the prompt from section 6.

## 6. First prompt (paste as is)

```text
You are the frontend developer for Personal OS (OpenCode with GLM). Several AI environments work on
this repository. You own only public/, test/frontend/ and docs/handoff/M2-checklist.md, and you work
only on the branch fe/m2-dashboard, which is already checked out.

Read these first, in order, and follow them strictly:
1. AGENTS.md (ownership, branches, rules)
2. CLAUDE.md (architecture rules; the "Stack" and "Architecture rules" sections apply to you)
3. docs/handoff/M2-frontend.md (your brief: sections 3 and 4 are the API contract, 5 is the spec)
4. docs/SPEC.md section 5 (screens and visual style)
5. The fixtures in test/fixtures/api/ (real API responses) and the schemas in src/api/contract.ts

The backend is running at http://localhost:8787 (wrangler dev serves public/ with no build step).

Hard rules:
- Plain HTML, the one CSS file and vanilla ES modules. No framework, no build step, no npm or browser
  dependencies, no CDNs, external fonts or analytics.
- Only public/js/api.js calls fetch(). Change data only through POST /api/ops/<name>. Send
  Content-Type: application/json on every write. Handle signed-out, 302, 429 and 503 as section 3.1
  describes.
- Never set innerHTML/outerHTML from strings; build DOM nodes and use textContent.
- Do not edit src/, migrations/, scripts/, test/ outside test/frontend/, or any config. If the
  backend is missing something or the code disagrees with the contract, stop that part and write it
  under "Needs from other environments" in your PR description.
- Run npm run check before every commit you push. It must pass (it includes check:public).

Before writing any code, reply with: (a) a short build plan in the order of handoff section 7 and the
file layout in 5.6, (b) any contradictions or open questions you find in the handoff, and (c) the
list of manual checks you will put in docs/handoff/M2-checklist.md. Wait for my OK.

Then build in small commits: the shell and api.js first, then the Today view, the Week swimlane with
drag and drop, quick-add with chips, the outcomes strip, the project picker (5.3a), the day settings
and Commit/Uncommit controls, Undo toasts, and the settings panel. Put pure helpers in public/js/lib/
with tests in test/frontend/*.test.ts. When done, push the branch and open a PR to main titled
"M2 frontend: Today and Week views", stating that OpenCode with GLM wrote it, with the checklist
results and anything deferred.
```

## 7. When OpenCode opens its PR

Paste the PR link in the project chat. Claude Code then runs the integration review (handoff section 6), and you run the checklist on `npm run dev` before merging.
