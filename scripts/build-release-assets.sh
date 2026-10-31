#!/usr/bin/env bash
# Junta os instaladores baixados dos jobs de build numa pasta única e gera
# SHA256SUMS.txt + latest.json (manifesto do updater) — #32. Hoje só macOS é
# publicado; as outras plataformas ficam comentadas, prontas para religar junto
# com a matriz de .github/workflows/release.yml.
#
# Uso: ./scripts/build-release-assets.sh <pasta-dos-artefatos> <tag> <owner/repo>
#
# <pasta-dos-artefatos> tem uma subpasta por job de build (scrible-macos-arm64,
# scrible-windows-x64, …), como o actions/download-artifact entrega. O resultado
# fica em <pasta-dos-artefatos>/release/.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Uso: $0 <pasta-dos-artefatos> <tag> <owner/repo>" >&2
  exit 1
fi

src="$1"
tag="$2"
repo="$3"
out="$src/release"
version="${tag#v}"

rm -rf "$out"
mkdir -p "$out"

# Procura exatamente um arquivo que case com o padrão dentro da pasta de um job.
find_one() {
  local dir="$src/$1" pattern="$2"
  local matches
  matches="$(find "$dir" -type f -name "$pattern" 2>/dev/null | sort)"
  local count
  count="$(printf '%s\n' "$matches" | grep -c . || true)"
  if [[ "$count" -ne 1 ]]; then
    echo "Esperava 1 arquivo '$pattern' em $dir, achei $count" >&2
    exit 1
  fi
  printf '%s' "$matches"
}

# Copia todos os arquivos que casam com o padrão; recusa nomes repetidos entre
# plataformas (colidiriam como assets da mesma release).
copy_all() {
  local dir="$src/$1" pattern="$2" f
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ -e "$out/$(basename "$f")" ]]; then
      echo "Nome de asset repetido entre plataformas: $(basename "$f")" >&2
      exit 1
    fi
    cp "$f" "$out/"
  done < <(find "$dir" -type f -name "$pattern" | sort)
}

# plataforma-do-updater:job:padrão-do-pacote-do-updater
platforms=(
  "darwin-aarch64:scrible-macos-arm64:scrible.app.tar.gz"
  # "windows-x86_64:scrible-windows-x64:*-setup.exe"
  # "windows-aarch64:scrible-windows-arm64:*-setup.exe"
  # "linux-x86_64:scrible-linux-x64:*.AppImage"
  # "linux-aarch64:scrible-linux-arm64:*.AppImage"
)

jq_platforms='{}'
for entry in "${platforms[@]}"; do
  IFS=: read -r key job pattern <<<"$entry"
  pkg="$(find_one "$job" "$pattern")"
  sig="$(find_one "$job" "$(basename "$pkg").sig")"
  name="$(basename "$pkg")"
  if [[ -e "$out/$name" ]]; then
    echo "Nome de asset repetido entre plataformas: $name" >&2
    exit 1
  fi
  cp "$pkg" "$sig" "$out/"
  jq_platforms="$(jq -c \
    --arg key "$key" \
    --arg signature "$(cat "$sig")" \
    --arg url "https://github.com/${repo}/releases/download/${tag}/${name}" \
    '. + {($key): {signature: $signature, url: $url}}' <<<"$jq_platforms")"
done

# Instaladores que não são pacote do updater: .dmg (macOS) e .deb (Linux).
copy_all scrible-macos-arm64 "*.dmg"
# copy_all scrible-linux-x64 "*.deb"
# copy_all scrible-linux-arm64 "*.deb"

jq -n \
  --arg version "$version" \
  --arg notes "https://github.com/${repo}/releases/tag/${tag}" \
  --arg pub_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson platforms "$jq_platforms" \
  '{version: $version, notes: $notes, pub_date: $pub_date, platforms: $platforms}' \
  > "$out/latest.json"

# Checksum de tudo o que é instalador/pacote (não do próprio manifesto).
(
  cd "$out"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum $(ls | grep -v -e '^latest.json$' -e '^SHA256SUMS.txt$') > SHA256SUMS.txt
  else
    shasum -a 256 $(ls | grep -v -e '^latest.json$' -e '^SHA256SUMS.txt$') > SHA256SUMS.txt
  fi
)

echo "Assets em $out:"
ls -1 "$out"
