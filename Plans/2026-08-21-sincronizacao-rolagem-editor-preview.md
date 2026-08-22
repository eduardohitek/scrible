# Plan: Sincronização de rolagem entre editor e preview (Issue #20)

**Date:** 2026-08-21
**Status:** Approved

---

## Objective

Rolar o editor deve rolar o preview (e vice-versa) mantendo a posição relativa
correspondente — sem isso, o preview perde utilidade em documentos longos.
Depende de #17 (pipeline markdown-it/`debouncedSource`), #18 (mermaid) e #19
(layout split), todas já mescladas em `main`.

---

## Decisões da sabatina

- `EditorPane`/`PreviewPane` expõem uma API imperativa mínima via `forwardRef`
  + `useImperativeHandle` — `SplitLayout` usa essas handles para orquestrar o
  sync (descartado: wrapper-div+querySelector, store zustand).
- Blocos do preview são marcados com `data-source-line` por uma regra
  hand-rolled no pipeline `markdown-it` existente (mesmo padrão de
  `extractFrontMatter`, #17) — sem dependência nova.
- Mapeamento por **interpolação proporcional** entre blocos vizinhos
  marcados, recalculada ao vivo a cada evento de scroll (não cacheada) —
  tolera blocos mermaid que mudam de altura assincronamente sem tratamento
  especial.
- Lógica de orquestração isolada num hook novo, `src/layout/useScrollSync.ts`.
- Guard anti-loop: flag ref (`isSyncingRef`) setada antes do scroll
  programático, liberada no próximo `requestAnimationFrame`.
- Matemática de interpolação extraída em funções puras testadas. Wiring de
  DOM/scroll real fica só verificação manual (precedente de #12/#18/#22/#23).
- Troca de aba / toggle do preview: nenhum código de resync explícito — o
  mecanismo natural de eventos de scroll já cobre a troca de aba.

## Fatos confirmados na exploração

- `EditorView.lineBlockAt(pos)`/`lineBlockAtHeight(height)` retornam
  `BlockInfo { from, length, top, height }` com `top` relativo ao topo do
  documento — geometria exata de linha↔pixel no editor, sem interpolação
  própria.
- markdown-it renderiza os atributos de um token `fence` no `<code>`, não no
  `<pre>` — ao trocar o bloco mermaid por `<div class="mermaid-diagram">`/
  `.mermaid-error`, o atributo `data-source-line` precisa ser copiado do
  `<code>` para o elemento substituto.
- `DOMPurify.sanitize` mantém atributos `data-*` por padrão
  (`ALLOW_DATA_ATTR = true`) — sem configuração extra.
- `token.level === 0` isola tokens de bloco de topo dos aninhados (ex.:
  `list_item_open` é nível 1).

---

## Implementation Steps

1. Criar `src/layout/scrollMapping.ts`: tipo `LineAnchor { line, top }` e
   funções puras `lineToOffset(anchors, line)` / `offsetToLine(anchors, offset)`
   com interpolação linear entre âncoras vizinhas + âncoras sintéticas de
   início/fim.
2. Criar `src/layout/scrollMapping.test.ts`: testes unitários das duas
   funções (interpolação, clamp/extrapolação, lista com 1 âncora, simetria
   ida-e-volta).
3. Modificar `src/editor/EditorPane.tsx`: converter para `forwardRef`,
   exportar `EditorPaneHandle { getScrollDOM, getTopVisibleLine, scrollToLine }`.
4. Modificar `src/preview/PreviewPane.tsx`: adicionar `sourceLinePlugin`
   (core rule do markdown-it marcando `data-source-line` em tokens
   `level === 0` com `.map`), propagar o atributo ao substituir blocos
   mermaid por `.mermaid-diagram`/`.mermaid-error`, converter para
   `forwardRef` expondo `PreviewPaneHandle { getContainer }`.
5. Criar `src/layout/useScrollSync.ts`: hook que liga os dois handles,
   calcula âncoras do preview ao vivo, aplica interpolação e guard
   anti-loop via `requestAnimationFrame`.
6. Modificar `src/layout/SplitLayout.tsx`: criar as refs, chamar
   `useScrollSync`, passar as refs para `EditorPane`/`PreviewPane`.
7. Rodar `mise run lint`, `mise run typecheck`, `mise run test`.
8. Verificação manual via `mise run dev` cobrindo os critérios de aceite da
   issue (scroll em ambas direções, sem loop, diagrama mermaid grande não
   quebra o mapeamento, toggle do preview e troca de aba não quebram o sync).
9. Commit + push + PR com `Closes #20` no corpo.
10. Atualizar `DECISIONS.md` com entrada `## #20`.

---

## Expected Outcomes

- Rolar o editor posiciona o preview no conteúdo correspondente, e vice-versa.
- Sem loop/tremor de scroll em nenhuma direção.
- Diagramas mermaid grandes não quebram o mapeamento dos blocos seguintes.
- `EditorPaneHandle`/`PreviewPaneHandle` ficam disponíveis como padrão
  reutilizável para futuras issues que precisem de acesso imperativo aos
  painéis (ex.: #24, #25).

---

## Risks & Considerations

- A tabela de metadados do front matter não passa pelo pipeline de tokens do
  markdown-it (é HTML concatenado à parte), então não vira âncora — aceito
  conscientemente, coberto pela âncora sintética do início do documento.
- Granularidade de interpolação é por bloco de topo (`level === 0`); dentro
  de um bloco grande (parágrafo longo, tabela grande), o mapeamento é
  aproximado, não linha-a-linha exata — consistente com o critério de aceite
  da issue ("aproximadamente").
