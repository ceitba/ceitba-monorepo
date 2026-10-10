# Conventional Commits for commits and PR titles

History before the monorepo mixes free-form subjects ("Add …", "Wiki pipeline: …") with a few Conventional Commits.
From the monorepo on, every commit subject and PR title is `type(scope): summary`, checked by the `commit-msg` git
hook and by CI on PR titles. The scope is the app (`api`, `web`, `scheduler`, `newsletter`) or area (`infra`, `ci`,
`deps`, `agents`, a feature such as `wiki`), which keeps the old "area:" habit. Merge commits are exempt because
the release flow uses real merge commits.
