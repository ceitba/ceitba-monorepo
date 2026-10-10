@AGENTS.md

<!-- Claude Code reads CLAUDE.md, not AGENTS.md. Keep every shared rule in AGENTS.md; add only Claude-specific notes
below. -->

## Claude Code notes

- Project settings and hooks live in `.claude/settings.json`; skills are symlinks into `.agents/skills/`.
- Reviewer subagents in `.claude/agents/` are generated: edit `.agents/agents/<name>.md` and run
  `node scripts/agents/sync.mjs`.
