#!/usr/bin/env bash
# Confere se uma tag de release (ex: v0.1.0-rc.1) corresponde à versão em
# package.json (fonte única de versão do projeto — ver tauri.conf.json).
#
# Uso: ./scripts/check-version.sh <tag>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: $0 <tag>" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tag="$1"
tag_version="${tag#v}"

if [[ -z "$tag_version" || "$tag" == "$tag_version" ]]; then
  echo "Tag inválida: '$tag' — esperado o formato vX.Y.Z (ex: v0.1.0 ou v0.1.0-rc.1)" >&2
  exit 1
fi

# Caminho relativo a partir da raiz: no Git Bash do Windows `$repo_root` vem como
# /d/a/..., que o Node (nativo do Windows) não resolve — #32.
pkg_version="$(cd "$repo_root" && node -p "require('./package.json').version")"

if [[ "$tag_version" != "$pkg_version" ]]; then
  echo "Divergência de versão: tag '$tag' (=> $tag_version) != package.json ($pkg_version)" >&2
  echo "Rode 'mise run release <versão>' para gerar o bump correto antes de taguear." >&2
  exit 1
fi

echo "OK: tag $tag corresponde à versão do package.json ($pkg_version)"
