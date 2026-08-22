# Plan: Busca e substituição no documento (#16)

**Date:** 2026-08-22
**Status:** Approved

---

## Objective

Implementar busca e substituição de texto no documento ativo (Cmd+F / Cmd+Option+F), usando
`@codemirror/search` (já instalado). O `searchKeymap` já está registrado em
`editorStateRegistry.ts`, mas a extensão `search()` em si nunca foi adicionada — hoje Cmd+F não
faz nada (bug latente). O trabalho real é: ligar a extensão, decidir a semântica de Cmd+Option+F
(a versão instalada da lib sempre mostra os campos de busca e substituição juntos, sem estado
oculto/visível para o replace) e estilizar o painel com os tokens de tema (#22).

---

## Implementation Steps

1. `src/theme/tokens.css`: adicionar `--color-search-match-bg` e
   `--color-search-match-selected-bg` (pares `light-dark()`), tokens semânticos novos para o
   highlight de ocorrências.
2. `src/editor/searchExtensions.ts` (novo): `search({ top: true })` + um comando customizado
   ligado a `Mod-Alt-f` que chama `openSearchPanel` e move o foco pro campo de replace (efeito
   prático do atalho, já que não existe estado "só busca" vs "busca+replace" pra alternar).
3. `src/editor/editorStateRegistry.ts`: incluir `searchExtensions` em `buildExtensions`.
4. `src/editor/editorTheme.ts`: estilizar `.cm-panel.cm-search`, `.cm-textfield`, `.cm-button`,
   `.cm-searchMatch`/`.cm-searchMatch-selected` com tokens existentes + os novos do passo 1 —
   mesmo padrão já usado ali para o tooltip do autocomplete.
5. `src/editor/searchExtensions.test.ts` (novo): `EditorView` real em jsdom — Cmd+F abre o painel;
   `setSearchQuery`/`findNext`/`findPrevious` destacam e navegam ocorrências; `replaceNext`/
   `replaceAll` alteram o doc corretamente; Esc fecha o painel e devolve o foco; Cmd+Option+F foca
   o campo de replace.
6. Verificação manual via `mise run dev`: conferência visual em tema claro e escuro.
7. Atualizar `DECISIONS.md` com o achado do bug latente (`searchKeymap` sem `search()`) e o desvio
   de semântica do Cmd+Option+F em relação ao texto literal da issue.

---

## Expected Outcomes

- Cmd+F abre a busca no topo do editor, destacando todas as ocorrências ao digitar.
- Substituir uma ocorrência e substituir todas funcionam corretamente.
- Esc fecha a busca e devolve o foco ao editor.
- Visual da barra de busca consistente com tema claro/escuro.
- Cmd+Option+F abre a busca com foco no campo de substituição.

---

## Risks & Considerations

- Escopo desta issue não inclui integração com o menu nativo (#24, que depende de #16 e ainda está
  bloqueada) — só o comportamento dentro do CodeMirror.
- Cmd+Option+F é um desvio consciente do texto literal da issue (que supunha um toggle de
  visibilidade do replace que não existe na versão instalada da lib) — decisão tomada via sabatina
  com o usuário antes deste plano.
