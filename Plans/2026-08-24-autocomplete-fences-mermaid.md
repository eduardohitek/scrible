# Plan: #15 — Autocomplete grupo D: linguagens em fences e snippets mermaid

**Date:** 2026-08-24
**Status:** Approved

---

## Objective

Adicionar autocomplete de linguagem em blocos de código com fence (` ``` `) e, ao escolher
`mermaid`, um segundo nível de sugestão com os 7 tipos de diagrama mais usados, cada um inserindo
um esqueleto sintaticamente válido com o cursor pronto para edição — grupo "D" da sabatina,
fechando as duas lacunas que a `#14` deixou de propósito ("Bloco de código" sem linguagem,
"Diagrama mermaid" com `flowchart` fixo).

---

## Implementation Steps

1. Criar `src/editor/fenceCompletions.ts`: `FENCE_LANGUAGES` (~24 linguagens), `MERMAID_SKELETONS`
   (7 tipos, texto puro), `fenceLanguageSource` (1º nível, `from` após as crases, suprime no fence
   de fechamento), `mermaidTypeSource` (2º nível, só dispara em bloco `mermaid` ainda sem tipo
   declarado), `withChainedCompletion` (encadeia via `startCompletion(view)`). `isInsideCodeBlock`
   migra de `slashMenu.ts` para cá.
2. Atualizar `src/editor/slashMenu.ts`: itens "Bloco de código" e "Diagrama mermaid" passam a
   encadear nos novos menus; as três fontes (`slashCommandSource`, `fenceLanguageSource`,
   `mermaidTypeSource`) entram no mesmo `autocompletion({ override: [...] })`; export renomeado
   para `editorCompletion`.
3. Atualizar `src/editor/editorStateRegistry.ts`: import/uso renomeado para `editorCompletion`.
4. Criar `src/editor/fenceCompletions.test.ts`: testes headless das duas fontes, teste com
   `EditorView` real provando o encadeamento ` ``` ` → `mermaid` → tipo, e `mermaid.parse()` sobre
   os 7 esqueletos.
5. Atualizar `src/editor/slashMenu.test.ts`: os dois testes de inserção que afirmam o comportamento
   antigo (fence sem linguagem, flowchart fixo) passam a afirmar o novo comportamento encadeado.
6. Rodar `mise run lint`, `mise run typecheck`, `mise run test`; verificação manual via
   `mise run dev` cobrindo os 7 tipos de diagrama, o encadeamento, a supressão no fechamento de
   fence e em bloco mermaid já preenchido, e os itens do menu `/`.
7. Atualizar `DECISIONS.md` com a entrada `## #15`.
8. Commit, push e abrir PR com `Closes #15` no corpo, a partir da branch
   `feat/15-autocomplete-fences-mermaid`.

---

## Expected Outcomes

- ` ``` ` no início de uma linha sugere ~24 linguagens (incluindo `mermaid`); aceitar insere o
  fence completo com o cursor no corpo.
- Escolher `mermaid` abre automaticamente a lista dos 7 tipos de diagrama; aceitar um tipo insere
  um esqueleto válido, cursor no fim do corpo.
- Cada um dos 7 esqueletos é validado automaticamente via `mermaid.parse()` e renderiza sem erro no
  preview (critério de aceite, validado contra `#18`).
- Menu `/`: "Bloco de código" e "Diagrama mermaid" agora encadeiam nos menus de linguagem/tipo em
  vez de inserir conteúdo fixo — dívida da `#14` fechada.

---

## Risks & Considerations

- `override` do `autocompletion()` precisa conter as três fontes numa lista só — uma segunda
  extensão `autocompletion()` não somaria, substituiria a configuração existente.
- O encadeamento via `startCompletion(view)` não é automático no CM6 após aceitar uma completion;
  precisa ser chamado explicitamente no `apply` do item `mermaid`.
- O menu de tipos precisa parar de disparar assim que o bloco mermaid já tem uma linha de tipo
  declarada, para não reabrir a cada Enter dentro de um diagrama existente.
