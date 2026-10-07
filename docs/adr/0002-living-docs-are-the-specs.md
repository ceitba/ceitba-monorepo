# Living docs are the specs; spec issues are snapshots

We do spec-driven development with `mattpocock/skills` instead of GitHub Spec Kit. Its `/to-spec` publishes a spec
as a GitHub issue that records the decisions for one piece of work and goes stale once that work ships. What stays
true is the feature doc in `docs/` or `apps/*/docs/` (e.g. `SCHEDULE-CORRECTIONS.md`), so those docs are the
living specs: any behaviour change, bug fixes included, updates the doc that `docs/agents/spec-map.json` maps to the
changed code, in the same PR. Lasting decisions go to ADRs here, vocabulary to `GLOSSARY.md`.

## Considered options

- GitHub Spec Kit (`.specify/`, `specs/NNN-slug/`): dropped. It overlaps with the Matt Pocock flow and its
  per-feature spec folders duplicate the feature docs we already maintain.
- Spec files under `docs/specs/` kept in sync by agents: rejected. That is a second copy of the feature docs.
