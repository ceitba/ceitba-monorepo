# AGENTS.md is the single source of agent rules

Contributors use different coding agents (Claude Code, Codex, Kiro, Cursor, Copilot), and each reads a different
file. We keep every rule in `AGENTS.md` (root plus one per app); `CLAUDE.md` files only contain `@AGENTS.md`
because Claude Code ignores `AGENTS.md` when a `CLAUDE.md` exists. Skills live once in `.agents/skills/` (read
natively by Codex, Cursor and Copilot) and are symlinked into `.claude/skills/` and `.kiro/skills/`. Reviewer
subagents are written once in `.agents/agents/` and generated per tool by `scripts/agents/sync.mjs`, because each
tool has its own subagent format.

## Consequences

Instructions are advice. Rules that must hold are enforced by git hooks, CI checks and agent hooks, not by prose.
