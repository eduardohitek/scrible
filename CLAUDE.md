# CLAUDE.md

Contexto e convenções deste repositório para sessões do Claude Code. Complementa o `README.md` (stack, setup, tasks) — não repete.

## Propósito do projeto

scrible é um editor de markdown com preview em tempo real (incluindo mermaid) e autosave direto no arquivo, feito com Tauri v2 + React/TypeScript, inicialmente para macOS.

## Fluxo de trabalho

O backlog vive nas issues do GitHub (`eduardohitek/scrible`). Funcionalidades novas entram como **specs** (ver seção abaixo); os milestones `v0.1 — MVP` e `v0.2` são legado e não recebem issues novas. O trabalho avança uma issue (ou sub-issue) por vez:

1. **Antes de planejar a implementação de uma issue, ler `DECISIONS.md`** — verificar se alguma decisão anterior (formato de erro, convenção de path, estrutura de store, etc.) impacta a issue atual.
2. Antes de qualquer plano formal, rodar a sabatina (conforme instrução global do usuário).
3. Criar uma branch a partir de `main` atualizada. Nunca commitar direto em `main`.
   - Issues: `feat/{numero-da-issue}-{slug}`. Numa spec, o número é o da **sub-issue**, não o da spec pai.
   - Trabalho de processo sem issue associada: `chore/{slug}`.
4. Implementar, verificar (`mise run lint`, `mise run typecheck`, `mise run test`, e verificação manual via `mise run dev` quando houver UI).
5. Assim que o plano estiver implementado e verificado, commitar, dar push e abrir o PR — não é preciso esperar pedido explícito a cada vez. No corpo do PR (não só na mensagem de commit), usar sempre a palavra-chave em **inglês** `Closes #N` (não `Fecha #N`) quando o PR fechar uma issue — é a única forma que o GitHub reconhece para auto-fechar.
6. Ao concluir uma issue cujas decisões possam afetar issues futuras, **atualizar `DECISIONS.md`** antes de considerar o trabalho fechado.
7. Atualizações de `CLAUDE.md` ou `DECISIONS.md` entram **na branch da alteração que as motivou** — não criar uma branch nem um PR separado só para isso, mesmo quando a atualização for retroativa (cobrindo uma issue anterior).

## Specs

Uma **spec** representa **uma entrega** (algo que justifica uma release por si só) e é composta de sub-tasks menores e testáveis.

- **Spec** = issue do GitHub com label `spec`, sem milestone. Corpo: `Objetivo` / `Decisões da sabatina` / `Fora de escopo` / `Critérios de aceite da entrega` / `Dependências`.
- **Sub-task** = sub-issue nativa do GitHub vinculada à spec, com o label de área (`área:*`). Corpo: `Objetivo` / `O que fazer` / `Como testar` / `Dependências`. Cada sub-issue traz seus próprios testes — "Como testar" é o critério de pronto dela.
- Refinar uma funcionalidade em spec passa pela sabatina; as decisões dela vão para o corpo da spec. Na hora de implementar uma sub-issue, o plano formal segue o fluxo acima (ler `DECISIONS.md`, sabatina só do que ficou em aberto).
- **1 sub-issue = 1 branch = 1 PR** (`Closes #<sub-issue>`). A spec fecha quando a última sub-issue fechar.
- Ordenar as sub-issues de modo que a `main` continue liberável após cada merge — nenhum merge deixa comportamento visível pela metade. A release sai quando a spec inteira estiver pronta.
- Partes compartilhadas entre specs (ex.: código comum a vários SOs) ficam numa sub-issue de uma delas; as outras a listam em `Dependências`. Se a ordem de execução mudar, a sub-issue migra para a spec que vier primeiro.

Criar sub-issue via CLI: `gh issue create ...` e depois `gh api repos/eduardohitek/scrible/issues/<spec>/sub_issues -F sub_issue_id=<id>` — `id` é o id interno (`gh issue view N --json id` não serve; use `gh api repos/eduardohitek/scrible/issues/N --jq .id`).

## Release

A versão do projeto vive só em `package.json` (`tauri.conf.json` lê de lá). O bump nunca commita direto na `main`:

1. Na `main` atualizada, rode a skill `/release` — analisa os merges desde a última tag, sugere a versão, roda o gate local (lint/typecheck/test), executa o bump (`mise run release`) e abre o PR.
2. Revisar o diff, merge.
3. Pronto — `.github/workflows/auto-tag.yml` detecta o merge (branch `chore/release-v*`), cria a tag `vX.Y.Z` e dispara `.github/workflows/release.yml` (build + publicação do `.dmg` assinado ad-hoc + checksum na página de releases) sozinho, via `workflow_dispatch`. Nenhum comando manual depois do merge.

Fallback se a automação do passo 3 falhar: `mise run tag` na `main` atualizada cria e envia a tag manualmente, disparando `release.yml` do jeito de sempre (`push: tags`).

## Decisões de arquitetura

Ver `DECISIONS.md` para o log completo, por issue, do que foi decidido e quais issues futuras cada decisão afeta.
