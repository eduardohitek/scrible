#!/usr/bin/env bash
# Prepara o bump de versão para uma release: cria a branch chore/release-vX.Y.Z,
# atualiza package.json (fonte única de versão) e sincroniza src-tauri/Cargo.toml.
# Não faz push nem abre PR — isso é manual, para revisão.
#
# Uso: ./scripts/prepare-release.sh <versão>   (ex: 0.1.0-rc.1)
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: $0 <versão>  (ex: 0.1.0 ou 0.1.0-rc.1)" >&2
  exit 1
fi

version="$1"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Árvore de trabalho suja — commit ou stash antes de preparar a release." >&2
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

release_branch="chore/release-v${version}"
git switch -c "$release_branch"

npm version "$version" --no-git-tag-version --allow-same-version >/dev/null

# Sincroniza a versão do Cargo.toml (não é a fonte, mas mantém os metadados coerentes)
sed -i '' '/^\[package\]/,/^\[/s/^version = ".*"/version = "'"$version"'"/' src-tauri/Cargo.toml
cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 >/dev/null

git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Release v${version}"

cat <<EOF

Branch '$release_branch' pronta com o bump para v${version}.

Próximos passos:
  1. git push -u origin $release_branch
  2. Abrir o PR e revisar o diff (package.json, package-lock.json, Cargo.toml, Cargo.lock)
  3. Depois do merge na main: mise run tag
EOF
