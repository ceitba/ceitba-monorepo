#!/bin/sh
# Pre-commit secret scan of the staged changes with the repo's .gitleaks.toml.
# CI scans every PR too, so a missing local binary only warns.
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks not installed: skipping local secret scan (CI still runs it). Install: brew install gitleaks" >&2
  exit 0
fi
exec gitleaks git --pre-commit --staged --redact --no-banner --config .gitleaks.toml
