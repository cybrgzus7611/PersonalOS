# Start M2 frontend work in OpenCode (DeepSeek V4.1 Flash) on Windows

For Nisa. Do these steps once PR #4 has merged into `main`. Run the commands in **PowerShell**, in the folder where you keep code.

## 1. Check the tools (once)

```powershell
git --version        # any recent Git
node --version       # must be v22.13 or later (Node 22 LTS)
opencode --version   # OpenCode, with DeepSeek V4.1 Flash connected
```

If `opencode` is missing, install it with `npm install -g opencode-ai`, then run `opencode` and connect your DeepSeek provider with the `/connect` command. The OpenCode docs cover this (opencode.ai/docs).

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
npm run sample:local
npm run check
```

Expect `Seeded 5 workstreams`, then `Loaded a sample week`, then all tests passing. Open http://localhost:8787 in the browser. The M1 placeholder page says "API OK".

## 5. Start OpenCode

In the second window:

```powershell
opencode
```

Pick DeepSeek V4.1 Flash with `/models`, then paste the prompt from section 6.

## 6. First prompt (paste as is)

```text
You are the frontend developer for Personal OS, working in OpenCode with DeepSeek V4.1 Flash.
Several AI environments work on this repository. You own only public/, test/frontend/ and
docs/handoff/M2-checklist.md, and you work only on the branch fe/m2-dashboard (already checked out).

Read these first, in order, and follow them strictly:
1. AGENTS.md (ownership, branches, rules)
2. CLAUDE.md (architecture rules; "Stack" and "Architecture rules" apply to you)
3. docs/handoff/M2-frontend.md, above all section 5.0 (your current task), 5.0b, and sections 3
   and 4 (the API contract)
4. docs/SPEC.md section 5 (screens) and section 7 (time blocks and metrics, for screens 4 and 5)
5. src/api/contract.ts and test/fixtures/api/ (the exact response shapes)

The backend runs at http://localhost:8787 with a realistic sample week loaded (npm run sample:local).

YOUR TASK NOW IS ONLY STAGE 1, the UI Design Playground (handoff section 5.0):
- public/playground/index.html at http://localhost:8787/playground/, with four materially different
  directions: A premium dark command centre, B modern light workspace, C editorial and
  information-dense, D glass and futuristic workspace.
- Each direction shows the same six screens: daily command centre, weekly project swimlane, project
  register, time-block accountability interface, progress and performance visualisations, and
  navigation and settings.
- Use real data: screens 1, 2, 3 and 6 read the live API (GET only) through public/js/api.js. Create
  api.js now as the one module that calls fetch(), as handoff 3.1 and 5.6 describe, and switch the
  M1 placeholder in public/js/main.js to use it. Screens 4 and 5 only may use the static file
  public/playground/future-sample.js, shaped like SPEC 7 and labelled "Illustrative: arrives in M3/M4".
  No mock server, no extra endpoints, no writes.
- Curation: a picker for direction and screen, a side-by-side compare mode, mix and match by token
  group (palette, typography, density and spacing, surfaces, controls, navigation, charts) through
  data-* attributes on <html>, notes per direction and screen kept in localStorage, and a
  "Copy feedback" button that copies a Markdown summary of the mix and notes.

Hard rules:
- Plain HTML, CSS and vanilla ES modules. No framework, build step, npm or browser dependencies,
  CDNs, web fonts from other sites, or analytics. Use system fonts or none.
- Never set innerHTML or outerHTML from strings; build DOM nodes and use textContent.
- Do not edit src/, migrations/, scripts/, config, or test/ outside test/frontend/. If something is
  missing from the backend, stop that part and list it under "Needs from other environments" in
  the PR description.
- Run npm run check before every push. It must pass (it includes check:public).
- Do NOT start the design system (5.0b) or the dashboard (5.1 to 5.6). They wait for Nisa's approval.

Before writing code, reply with: (a) your plan for the playground's files and how the token groups
will be structured, (b) one paragraph per direction on how they will differ (palette, type,
density, surfaces, layout), and (c) any contradictions or questions you find in the handoff.
Wait for my OK.

When the playground is done, commit, push fe/m2-dashboard, and open a PR to main titled
"M2 design playground". In the description, say that OpenCode with DeepSeek V4.1 Flash wrote it,
explain how to open and use the playground, and attach screenshots of all four directions. Then stop.
```

## 7. Reviewing the playground

1. Open http://localhost:8787/playground/ (with `npm run dev` running) and compare the directions, side by side if you like.
2. Mix the parts you like, write notes, then press **Copy feedback** and paste the result into the project chat.
3. Tell OpenCode which mix you chose. It then builds the design system (stage 2) and stops again for your approval. Only after that does it build the dashboard (stage 3).

Paste each PR link in the project chat. Claude Code reviews every frontend PR before you merge it.
