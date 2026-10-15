---
name: release
description: >
  Prepara e abre o PR de uma nova release do scrible: analisa os merges desde a última tag, sugere
  o número de versão (semver), roda o gate local (lint/typecheck/test), executa o bump de versão e
  abre o PR já com o corpo preenchido. Depois do merge desse PR, a release (tag + build + publicação
  do .dmg) roda sozinha via .github/workflows/auto-tag.yml — não é preciso rodar mais nada. Use
  quando o usuário pedir para "criar uma release", "fazer o release", "gerar uma nova versão",
  "abrir PR de release", ou digitar "/release".
---

# Release Skill

## Propósito

Automatizar o que hoje seria feito à mão depois de `mise run release`: analisar as mudanças,
decidir a versão, rodar o bump e abrir o PR. Ver `DECISIONS.md` (issue da automação de release) e
`CLAUDE.md` (seção "Release") para o desenho completo do pipeline — esta skill cobre só a metade
local (até o PR); o merge do PR é o que dispara `.github/workflows/auto-tag.yml`, que cria a tag e
aciona `release.yml` sozinho.

## Passos

### 1. Checar pré-condições

```sh
git status --short          # precisa estar vazio
git rev-parse --abbrev-ref HEAD   # precisa ser "main"
git fetch origin main --quiet
git rev-parse HEAD origin/main    # os dois hashes precisam bater
```

Se qualquer checagem falhar, **pare e explique ao usuário** o que resolver (branch errada, mudanças
não commitadas, `main` desatualizada) em vez de tentar consertar sozinho por conta própria.

### 2. Levantar as mudanças desde a última release

```sh
last_tag=$(git tag --sort=-creatordate | head -1)
git log "${last_tag}..HEAD" --merges --pretty=format:"- %b" | grep -v '^-\s*$'
```

Isso lista o título de cada PR mergeado desde a última tag (o corpo do commit de merge do GitHub é
o título do PR). Guarde essa lista — ela vira tanto a base da sugestão de versão quanto o corpo do
PR de release (passo 5).

Se a lista vier vazia, avise o usuário que não há mudanças desde `${last_tag}` e pergunte se ele
realmente quer prosseguir (pode ser uma release intencionalmente vazia, mas é incomum).

### 3. Sugerir a versão e confirmar com o usuário

Leia a versão atual: `node -p "require('./package.json').version"`.

Aplique esta heurística simples sobre a lista do passo 2 (não é Conventional Commits — o
histórico do repo não segue esse padrão, é julgamento sobre o conteúdo dos títulos):

- Qualquer item que pareça **funcionalidade nova ou visível ao usuário** (ex: "Zoom da interface",
  "Exportar para PDF") → sugere bump de **minor**.
- Se **todos** os itens forem claramente fix/chore/infra (ex: "Corrige X", "Ajusta pipeline de Y") →
  sugere bump de **patch**.
- Pré-1.0 (`0.x.y`), não existe "major" natural — não sugira major a menos que o usuário peça
  explicitamente uma mudança incompatível intencional.

Apresente ao usuário via `AskUserQuestion`: a versão atual, a lista de mudanças, a versão sugerida
com a justificativa, e deixe espaço pra ele digitar outra (a pergunta sempre aceita "Other"). Nunca
prossiga com uma versão sem essa confirmação explícita.

### 4. Gate local

```sh
mise run lint && mise run typecheck && mise run test
```

Se qualquer um falhar, **pare aqui** — reporte a falha ao usuário em vez de criar a branch de
release com código quebrado. `release.yml` (issue #63) não roda esse gate de novo — só valida
tag × versão — então este é o único ponto do pipeline que pega regressão antes do build de verdade.

### 5. Bump de versão

```sh
mise run release <versão-confirmada>
```

Reaproveita `scripts/prepare-release.sh` sem nenhuma mudança: cria `chore/release-v<versão>`,
atualiza `package.json`/`package-lock.json`/`Cargo.toml`/`Cargo.lock`, e para no commit local (não
faz push).

### 6. Push e PR

```sh
git push -u origin chore/release-v<versão>
```

Depois, `gh pr create` com:

- **Título:** `Release v<versão>`
- **Corpo:** a lista de mudanças do passo 2 sob um cabeçalho `## O que entra nesta release`, mais
  uma seção explícita avisando que **mergear este PR já dispara a release automaticamente** (tag +
  build + publicação do `.dmg` via `auto-tag.yml` → `release.yml`) — sem nenhum comando manual
  depois. Não é preciso lembrar o usuário de rodar `mise run tag`; isso agora só existe como
  fallback caso a automação falhe.

### 7. Reportar

Devolva ao usuário a URL do PR e a versão escolhida. Não faça merge — isso continua sendo decisão
do usuário.

## Fallback

Se `auto-tag.yml` falhar por algum motivo depois do merge (ex: runner fora do ar), `mise run tag`
continua funcionando manualmente a partir da `main` já atualizada — não precisa desta skill de novo
pra esse caso, só o comando direto.
