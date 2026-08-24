#!/usr/bin/env bash
# Cria e envia a tag da versão atual (lida de package.json) a partir da main.
# O push da tag é o que dispara o workflow de release no GitHub Actions.
#
# Uso: ./scripts/tag-release.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Árvore de trabalho suja — commit ou stash antes de taguear." >&2
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "main" ]]; then
  echo "Rode a partir da branch 'main' (branch atual: $current_branch)." >&2
  exit 1
fi

git fetch origin main --quiet
local_head="$(git rev-parse HEAD)"
remote_head="$(git rev-parse origin/main)"
if [[ "$local_head" != "$remote_head" ]]; then
  echo "main local está desatualizada em relação a origin/main — rode 'git pull --ff-only' antes." >&2
  exit 1
fi

version="$(node -p "require('$repo_root/package.json').version")"
tag="v${version}"

if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "Tag $tag já existe localmente." >&2
  exit 1
fi

git tag -a "$tag" -m "Release $tag"
git push origin "$tag"

echo "Tag $tag enviada — acompanhe o workflow de release em:"
echo "  https://github.com/eduardohitek/scrible/actions/workflows/release.yml"
