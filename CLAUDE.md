# CLAUDE.md

Contexto e convenções deste repositório para sessões do Claude Code. Complementa o `README.md` (stack, setup, tasks) — não repete.

## Propósito do projeto

scrible é um editor de markdown com preview em tempo real (incluindo mermaid) e autosave direto no arquivo, feito com Tauri v2 + React/TypeScript, inicialmente para macOS.

## Fluxo de trabalho

O backlog vive nas issues do GitHub (`eduardohitek/scrible`), organizado nos milestones `v0.1 — MVP` e `v0.2`. O trabalho avança uma issue por vez:

1. **Antes de planejar a implementação de uma issue, ler `DECISIONS.md`** — verificar se alguma decisão anterior (formato de erro, convenção de path, estrutura de store, etc.) impacta a issue atual.
2. Antes de qualquer plano formal, rodar a sabatina (conforme instrução global do usuário).
3. Criar uma branch a partir de `main` atualizada. Nunca commitar direto em `main`.
   - Issues: `feat/{numero-da-issue}-{slug}`.
   - Trabalho de processo sem issue associada: `chore/{slug}`.
4. Implementar, verificar (`mise run lint`, `mise run typecheck`, `mise run test`, e verificação manual via `mise run dev` quando houver UI).
5. Assim que o plano estiver implementado e verificado, commitar, dar push e abrir o PR — não é preciso esperar pedido explícito a cada vez. No corpo do PR (não só na mensagem de commit), usar sempre a palavra-chave em **inglês** `Closes #N` (não `Fecha #N`) quando o PR fechar uma issue — é a única forma que o GitHub reconhece para auto-fechar.
6. Ao concluir uma issue cujas decisões possam afetar issues futuras, **atualizar `DECISIONS.md`** antes de considerar o trabalho fechado.
7. Atualizações de `CLAUDE.md` ou `DECISIONS.md` entram **na branch da alteração que as motivou** — não criar uma branch nem um PR separado só para isso, mesmo quando a atualização for retroativa (cobrindo uma issue anterior).

## Release

A versão do projeto vive só em `package.json` (`tauri.conf.json` lê de lá). O bump nunca commita direto na `main`:

1. Na `main` atualizada: `mise run release <versão>` — cria `chore/release-vX.Y.Z`, atualiza `package.json`/`Cargo.toml` e para no commit local.
2. Push, abrir PR, revisar o diff, merge.
3. Na `main` atualizada de novo: `mise run tag` — cria e envia a tag `vX.Y.Z`, que dispara `.github/workflows/release.yml` (build + publicação do `.dmg` assinado ad-hoc + checksum na página de releases).

## Decisões de arquitetura

Ver `DECISIONS.md` para o log completo, por issue, do que foi decidido e quais issues futuras cada decisão afeta.
