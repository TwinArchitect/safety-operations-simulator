# Codex Agent Rules - Fast Execution & Safe Operation Mode

## 0. Core Principle

This project prioritizes:

1. Fast deterministic execution over broad analysis.
2. Minimal changes over unnecessary improvements.
3. User control over repository state.
4. Completing the requested task and stopping immediately.

For routine execution tasks, act like a focused operator:

Execute the requested action.
Report the result.
Stop.

Do not expand the scope.

---

# 1. Routine Execution Mode

The following are routine execution tasks:

- git add / commit / push
- pnpm install / add / remove / run
- npm script execution
- starting or stopping development servers
- reading browser console/status
- checking deployment logs
- simple file reads
- simple file edits explicitly requested by the user

For routine tasks:

- Use minimal reasoning.
- Do not inspect unrelated project structure.
- Do not analyze architecture.
- Do not propose alternatives.
- Do not refactor.
- Do not optimize.
- Do not perform extra verification unless requested.

Complete the requested action and stop.

---

# 2. Git Rules

When the user requests git operations:

## Allowed operations

Directly execute:

- git status
- git add
- git commit
- git push
- git pull (only when explicitly requested)
- git log (when needed for status understanding)

Rules:

- If specific files are mentioned, add only those files.
- If the user says commit current work, commit current workspace changes.
- Use the provided commit message.
- If no commit message is provided, use:
  "update"
- Push immediately when requested.
- Do not run build/typecheck before git operations unless explicitly requested.
- Do not review full diff unless explicitly requested.

---

# 2.1 Git Safety Rules (Critical)

The agent must never destroy, hide, overwrite, or discard user work.

Never execute these commands unless the user explicitly requests the exact command:

- git reset --hard
- git clean -fd
- git restore .
- git restore <file>
- git checkout <branch>
- git switch <branch>
- git stash
- git rebase
- git merge
- deleting branches

Do not use Git commands as automatic cleanup tools.

If uncommitted changes exist:

- Assume they are intentional.
- Do not remove them.
- Do not overwrite them.
- Do not switch branches.
- Do not reset the repository.

The user's working directory has priority over repository cleanliness.

---

# 2.2 Git Branch Rules

Branch switching is a user-controlled operation.

Before switching branches:

Check:

git status

If there are uncommitted changes:

Stop and ask the user.

Never automatically:

- stash changes
- commit changes
- discard changes
- move changes between branches

---

# 2.3 Git Recovery Rules

If Git state becomes unclear:

Only run read-only commands:

- git status
- git log
- git reflog

Do not attempt automatic recovery.

Do not run:

- reset
- restore
- checkout
- clean
- stash

Wait for user instruction.

---

# 2.4 Git Failure Handling

If any git command fails:

Stop immediately.

Report:

- the exact command
- the exact error message

Do not:

- retry automatically
- change repository state
- diagnose deeply
- execute additional git commands

unless requested.

---

# 3. Package Manager Rules

For pnpm/npm operations:

Execute the requested command directly.

Do not:

- analyze dependency trees first
- upgrade packages
- modify package versions
- suggest alternatives

Do not run build/typecheck after installation unless requested.

If command fails:

Stop.

Report the exact failure.

Do not retry automatically.

---

# 4. File Modification Scope

Only modify files directly related to the request.

Do not:

- refactor architecture
- rename modules
- restructure folders
- improve unrelated code
- change styling outside the request
- modify configuration files unless required

Prefer the smallest working change.

---

# 5. Fast Patch Mode

When the user requests:

- "不要过多思考"
- "快速改完"
- "只改这几个点"
- "不要考虑其他影响"
- "快速补丁模式"
- "完成后停止"

Switch to Fast Patch Mode.

Rules:

- Do minimal investigation.
- Find only the relevant files.
- Make the smallest working change.
- Do not refactor.
- Do not optimize.
- Do not redesign.
- Do not explore unrelated issues.

Verification:

Run at most one lightweight check if useful.

Examples:

- tsc --noEmit
- targeted test
- browser refresh check

Then stop.

---

# 6. Browser / Deployment Rules

For:

- browser checks
- localhost checks
- Vercel checks
- deployment logs

Only inspect the requested target.

Do not:

- investigate unrelated errors
- modify files
- start debugging automatically

If an error appears:

Report the error.

Wait for instruction.

---

# 7. Verification Rules

Default verification is minimal.

For:

Simple UI/text changes:
- No build.

Small TypeScript changes:
- Optional typecheck.

Deployment changes:
- Build only when directly relevant.

Do not run multiple verification commands.

---

# 8. Failure Handling

If any command fails:

Stop immediately.

Report:

- what was executed
- what failed
- error output

Do not:

- retry repeatedly
- explore alternatives
- modify unrelated files

Wait for instruction.

---

# 9. Anti Loop Rule

If a routine task takes more than 5 minutes:

Stop.

Report:

- completed actions
- current state
- remaining issue

Do not continue exploring.

---

# 10. User Instruction Priority

The latest user instruction always overrides previous instructions.

If the user says:

- stop
- don't think
- only change X
- quick patch
- do not touch other files

Immediately narrow the task.

Do not continue previous analysis.

---

# 11. Reasoning Permission

Full reasoning is allowed only for:

- architecture design
- explicit debugging
- feature planning
- code review
- security-sensitive changes
- destructive operations

Even then:

Keep reasoning scoped to the user's request.

---

# 12. Low / Medium Reasoning Mode

When the user selects low or medium reasoning:

Treat it as Fast Execution Mode.

Do not:

- analyze broadly
- inspect unrelated files
- redesign solutions
- optimize architecture

Workflow:

1. Locate relevant code.
2. Make requested change.
3. Run minimal verification if needed.
4. Report result.
5. Stop.

---

# 13. Stop Condition

After completing the requested task:

Stop immediately.

Do not:

- suggest improvements
- continue investigating
- perform cleanup
- start another task

unless explicitly requested.

---

# 14. Permission Model

The agent may modify:

- source files required for the task

The agent may not autonomously modify:

- git history
- branches
- repository state
- dependency versions
- architecture

without explicit user instruction.