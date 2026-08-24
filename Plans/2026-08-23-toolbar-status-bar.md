# Plan: Consolidar o chrome da UI em toolbar + status bar (#60)

**Date:** 2026-08-23
**Status:** Approved
**Branch:** `feat/60-toolbar-status-bar`

---

## Objective

Hoje o scrible espalha o chrome da UI em **cinco elementos posicionados em absoluto/fixo**, todos
flutuando **por cima** do editor e do preview:

| Elemento | Âncora | Arquivo |
|---|---|---|
| `ThemeToggle` ("Sistema") | `absolute` topo-esquerda | `src/theme/ThemeToggle.tsx` |
| `HistoryPanel` ("Histórico") | `absolute` topo-direita | `src/history/HistoryPanel.tsx` |
| `PreviewToggleButton` ("Ocultar preview") | `absolute` base-esquerda | `src/layout/PreviewToggleButton.tsx` |
| `save-indicator` ("Salvando…") | `absolute` base-direita | `src/App.css:412` |
| `ExplorerToggleTab` ("▸") | `fixed` borda esquerda | `src/explorer/ExplorerToggleTab.tsx` |

Problemas concretos:

1. **Cobrem o texto** — os 4 cantos de `.app-shell-content` tapam as primeiras/últimas linhas do
   editor e do preview.
2. **O layout já bateu no teto.** O comentário em `ExplorerToggleTab.tsx:3-6` admite que a aba `▸`
   existe *"porque os 4 cantos já têm botões flutuantes, sem espaço livre para mais um"*, e
   `DECISIONS.md` #25 registra em `Afeta:` — *"Qualquer issue futura que precise de outro botão
   flutuante deve usar `.app-shell-content` como containing block — os 4 cantos já estão ocupados."*
3. **Labels de largura variável** — "Ocultar preview" ↔ "Mostrar preview" faz o botão mudar de
   tamanho ao clicar.
4. **Exportar HTML/PDF são invisíveis** — existem só no menu nativo (`src-tauri/src/app_menu.rs:27-28`).
5. **Atalhos indescobríveis** — `⇧⌘P`, `⇧⌘E`, `⌘F` só aparecem abrindo o menu do macOS. E a issue
   **#32 (builds Windows/Linux)** diz explicitamente: *"Windows/Linux não têm barra de menu global
   como o macOS — adaptar para menu de janela ou uma barra de comandos própria."*
6. **Duplicação já instalada** — `.theme-toggle` / `.history-toggle` / `.preview-toggle` são blocos
   CSS byte-idênticos (`App.css` 267-275, 308-316, 402-410); `.theme-menu` / `.history-panel` /
   `.explorer-context-menu` repetem a mesma superfície de popover; e existem **4 cópias manuais** do
   "fecha ao clicar fora".

**Resultado pretendido:** uma barra única no topo (abas à esquerda, grupo de ícones à direita) e uma
status bar fina no rodapé; **zero** elemento de chrome sobreposto ao conteúdo; um **registro central
de comandos** que passa a ser a fonte única para toolbar, menu nativo e — na issue B — a paleta de
comandos. Depende de #22, #23, #24, #25, #26, #27 — todas fechadas.

---

## Decisões da sabatina

1. **Estrutura: barra única + status bar.** Abas e ações na mesma linha (abas rolam à esquerda, grupo
   de ícones fixo à direita) + status bar no rodapé. Rejeitados: toolbar em linha própria (rouba
   ~34px permanentes de altura num editor de escrita) e activity bar vertical (só existe um painel
   lateral hoje, gastaria largura sem pagar).
2. **Ícones: `lucide-react`.** Nova dependência runtime. Rejeitados: SVGs escritos à mão (trabalho
   manual repetido e risco real de traço inconsistente) e manter texto/unicode (larguras variáveis,
   não cabem 6 ações numa linha).
3. **Sem barra de formatação markdown** (negrito/itálico/link). O app é markdown-first com atalhos e
   menu `/` já implementados (#13/#14) — seria redundante e encheria a barra. Vira issue separada se
   fizer falta.
4. **Status bar mostra:** estado de salvamento tri-estado (`Salvando…` / `Salvo` / `Não salvo`) +
   contagem de palavras e caracteres. **Fora:** linha/coluna do cursor (exigiria um
   `updateListener` novo publicando a seleção pra fora do CodeMirror) e caminho relativo do arquivo.
5. **Tema: ícone que reflete a preferência + dropdown.** O ícone muda (`Monitor` = Sistema, `Sun` =
   Claro, `Moon` = Escuro) e o clique abre o mesmo dropdown de 3 opções de hoje. Preserva o espírito
   de `DECISIONS.md` #23 ("mostra o estado atual sem exigir interação") com ~1/4 da largura.
   Rejeitado: botão de ciclo.
6. **Exportar: um ícone com dropdown HTML/PDF.** Um slot só, mesmo idioma de popover do tema e do
   histórico. Rejeitado: dois ícones (a #27 registra que export PDF é macOS-only, um ficaria morto
   no Windows/Linux).
7. **Tooltip CSS próprio, exibindo o atalho.** `::after` + `data-tooltip` em `App.css`. O `title`
   nativo do WKWebView demora ~1,5s e ignora os tokens — inútil como ferramenta de descoberta.
8. **Extrair só o mínimo compartilhado:** hook `useClickOutside` + classes `.icon-button` e
   `.popover-surface`. **Sem** criar componentes `Button`/`Popover`/`Modal` — rejeitado um design
   system completo (diff e risco desproporcionais num app que hoje não tem camada de primitivas).
9. **`ExplorerToggleTab` é removido.** O ícone na toolbar (`aria-pressed` + tooltip `⇧⌘E`) cobre
   100% da função. Reverte conscientemente a decisão registrada em `DECISIONS.md` #25 — a própria
   entrada previa isso ao dizer que a aba só existia por falta de espaço.
10. **Fatiado em duas issues sequenciais**, ambas no fluxo normal do `CLAUDE.md` (branch a partir da
    `main`, PR com `Closes #N`):
    - **Issue A (#60, milestone `v0.1 — MVP`)** — este plano: registro de comandos, toolbar, status
      bar, indicador de não-salvo na aba, largura de leitura no preview, remoção da aba `▸`.
    - **Issue B (v0.2, a abrir depois)** — paleta de comandos `⌘P` + modo foco, ambos consumindo o
      registro já pronto. Esboçada no fim deste arquivo.

---

## Fatos confirmados na exploração

- **Não existe nenhuma primitiva de UI** em `src/` — nem `Button`, nem `Tooltip`, nem `Popover`, nem
  um único `<svg>`. Todo "ícone" é glifo unicode literal (`▸`, `×`, `+`, `▾`).
- **`App.css` é a única folha de estilo de componentes** (`DECISIONS.md` #22, decisão via sabatina —
  sem CSS Modules/PostCSS/Tailwind). `tokens.css` é `:root` com custom properties e nada mais.
  `PreviewPane.css` é a exceção documentada: foi extraída na #26 para ser inlinada no export via
  `?raw`.
- **`markdownCommands.ts:238` já usa `Mod-k`** para `insertLink` → **`⌘K` não está livre** para a
  paleta de comandos. Some-se o achado da #24 (no macOS um `NSMenuItem` com accelerator intercepta
  a tecla **antes** da WKWebView): registrar a paleta em `⌘K` mataria o atalho de link. Daí a
  recomendação de **`⌘P`** na issue B.
- **`SplitLayoutHandle.openSearch()`** (`src/layout/SplitLayout.tsx:22`) é a única forma de alcançar
  a busca de fora da árvore React — o registro precisa de uma ponte imperativa para expor "Buscar".
- **`documentStore` já tem tudo** que a status bar e o ponto de não-salvo precisam:
  `DocumentEntry.status` (`"idle" | "saving" | "conflict" | "error"`) e `DocumentEntry.dirty`
  (`src/store/documentStore.ts:50-59`). Nenhuma lógica nova de estado.
- **Três testes selecionam por texto em português e vão quebrar:**
  `src/theme/ThemeToggle.test.tsx` (`getByText("Sistema")`), `src/layout/PreviewToggleButton.test.tsx`
  (`getByText("Ocultar preview")` + `getByRole("button")` assumindo botão único),
  `src/history/HistoryPanel.test.tsx` (`getByText("Histórico")`).
- **`.preview-pane` é ao mesmo tempo o container de scroll e o alvo do `innerHTML`** — a largura de
  leitura tem que ser aplicada aos *filhos*, não ao container.

---

## Implementation Steps

### 1. Dependência e tokens

- `npm install lucide-react`.
- `src/theme/tokens.css`: adicionar `--status-bar-height: 1.5rem`, `--reading-width: 70ch`,
  `--icon-size: 16px` e `--color-tooltip-bg` / `--color-tooltip-text` (ambos com `light-dark()`,
  seguindo a convenção da #22).

### 2. `src/commands/registry.ts` (novo — fundacional)

Fonte única de verdade das ações do app.

```ts
export interface AppCommand {
  id: string;                    // mesmos ids do menu nativo: "toggle_preview", "export_html", …
  label: string;                 // pt-BR
  shortcut?: string;             // só exibição: "⇧⌘P"
  run: () => void | Promise<void>;
  isActive?: () => boolean;      // alimenta aria-pressed nos toggles
}
export const commands: readonly AppCommand[];
export function runCommand(id: string): void;   // no-op silencioso para id desconhecido
```

Os `run()` chamam exatamente os mesmos alvos que o `switch` de hoje: `useLayoutStore.getState().togglePreview()`,
`useExplorerStore.getState().toggle()`, `useThemeStore.getState().setPreference(…)`,
`exportActiveTabAsHtml()` / `exportActiveTabAsPdf()` (`src/export/exportHtml.ts`),
`useTabsStore.getState().{newTab,openFileDialog,closeTab,startRenaming}`.

Ponte imperativa para o que vive dentro da árvore React:

```ts
export interface EditorBridge { openSearch(): void }
export function setEditorBridge(bridge: EditorBridge | null): void;
```

`App.tsx` a instala num `useEffect` e a **anula no cleanup** — regra registrada em `DECISIONS.md`
#21 ("todo efeito que cria/destrói recurso imperativo fora do React precisa anular a ref no
cleanup que o destrói"), o que também torna o StrictMode seguro.

### 3. `src/ui/useClickOutside.ts` (novo)

Extrai o efeito duplicado 4×. Assinatura `useClickOutside(ref, onClose, enabled)`, com `mousedown`
em `document` + `Escape` (superset do que `ExplorerContextMenu.tsx` já faz). Passa a ser consumido
por `ThemeToggle`, `HistoryPanel`, `ExplorerContextMenu` e pelo novo `ExportMenu`.

### 4. `src/ui/Toolbar.tsx` (novo)

Grupo de ícones, `flex: 0 0 auto`, alinhado à direita da barra do topo:

```
[PanelLeft explorador] │ [Search buscar] [Columns2 preview] [History histórico] │ [Download exportar ▾] [Monitor|Sun|Moon tema ▾]
```

Cada botão: `<button className="icon-button" aria-label={label} aria-pressed={isActive?.()}
data-tooltip={`${label} — ${shortcut}`}>`. Os três primeiros grupos disparam `runCommand(id)`; os
dois últimos renderizam os componentes de popover (passos 6 e 7).

### 5. `src/ui/StatusBar.tsx` (novo)

`flex: 0 0 auto`, último filho de `.app-shell-content`.
Esquerda: `{n} palavras · {n} caracteres` — `useMemo` puro sobre `activeDoc.content`.
Direita: estado tri-estado derivado de `status`/`dirty` — `"Salvando…"` quando `status === "saving"`,
`"Não salvo"` quando `dirty`, `"Salvo"` caso contrário.

### 6. `src/theme/ThemeToggle.tsx` (reescrever o render)

Mesmo store, mesmo dropdown de 3 opções. O gatilho vira `.icon-button` com o ícone escolhido por
`preference` (`Monitor`/`Sun`/`Moon`) e `aria-label` textual; o `<ul>` passa a usar
`.popover-surface`; o efeito local de clique-fora é substituído por `useClickOutside`.

### 7. `src/export/ExportMenu.tsx` (novo) e `src/history/HistoryPanel.tsx` (ajuste)

- `ExportMenu`: `.icon-button` (`Download`) + `.popover-surface` com "Exportar para HTML…" e
  "Exportar para PDF…", disparando `runCommand("export_html" | "export_pdf")`.
- `HistoryPanel`: botão vira `.icon-button` (`History`); a lógica de `invoke("list_snapshots")` /
  `restore_snapshot` fica intacta; troca o efeito local por `useClickOutside` e `.history-panel`
  passa a compor com `.popover-surface`.

### 8. `src/App.tsx` — nova composição

```jsx
<div className="app-shell">
  <ExplorerPanel />
  <div className="app-shell-content">
    <header className="app-header">
      <TabBar />
      <Toolbar />
    </header>
    {activeDoc?.status === "conflict" && <ConflictBanner />}   {/* passa a ser fluxo normal */}
    <SplitLayout ref={splitLayoutRef} … />
    <StatusBar />
  </div>
</div>
```

- O `switch` do listener `"menu"` (linhas 111-147) vira `runCommand(event.payload)`; sobra só o
  mapeamento `theme_system|theme_light|theme_dark` se os ids forem mantidos distintos — na prática
  eles já viram 3 comandos no registro, então o `switch` some inteiro (~36 linhas a menos).
- `<ThemeToggle/>`, `<PreviewToggleButton/>`, `<ExplorerToggleTab/>` e a `<div className="save-indicator">`
  saem do JSX raiz.
- `ConflictBanner` sai do posicionamento absoluto e entra no fluxo — depois dessa mudança
  **nenhum** elemento de chrome fica sobreposto ao conteúdo.

### 9. `src/tabs/TabBar.tsx` — ponto de não-salvo

Extrair um subcomponente `TabItem` que assina `useDocumentStore((s) => s.documents[tab.id]?.dirty ?? false)`
— mesma técnica de assinatura por item que `ExplorerNode` já usa em `ExplorerPanel.tsx`. Quando
`dirty`, renderiza `<span className="tab-dirty-dot">` no lugar do `×`, voltando ao `×` no `:hover`
da aba (padrão VS Code/Zed).

### 10. Arquivos removidos

- `src/layout/PreviewToggleButton.tsx` + `src/layout/PreviewToggleButton.test.tsx` (vira uma entrada
  do registro).
- `src/explorer/ExplorerToggleTab.tsx` (o ícone da toolbar assume).

### 11. CSS

`src/App.css`:
- `.app-header` — `display:flex; align-items:stretch; height: var(--tab-bar-height); background: var(--color-surface); border-bottom: 1px solid var(--color-border-subtle)`.
  `.tab-bar` perde background/border/height próprios e ganha `flex: 1 1 auto; min-width: 0` (mantendo
  `overflow-x: auto`, para as abas rolarem sem empurrar a toolbar).
- `.icon-button` e `.popover-surface` — **substituem** os 3 blocos byte-idênticos
  (`.theme-toggle`/`.history-toggle`/`.preview-toggle`) e consolidam as 3 superfícies de popover.
- `.app-tooltip` via `[data-tooltip]:hover::after` + `::before` (seta), com `--color-tooltip-*`,
  `pointer-events: none` e delay curto.
- `.status-bar` — `height: var(--status-bar-height)`, `justify-content: space-between`,
  `font-size: var(--font-size-xs)`, `color: var(--color-text-secondary)`.
- `.conflict-banner` perde `position/top/left/right/z-index`.
- Remover `.theme-toggle*`, `.history-toggle`, `.preview-toggle*`, `.save-indicator`,
  `.explorer-toggle-tab` e os `position: absolute` de `.history-panel-container` /
  `.theme-toggle-container`.

`src/preview/PreviewPane.css` — largura de leitura:
```css
.preview-pane > * { max-width: var(--reading-width); margin-inline: auto; }
```
Aplicada aos **filhos**, não ao `.preview-pane` (que é o container de scroll e o alvo do
`innerHTML`). Rejeitado `display: grid` no container: grid items não fazem margin-collapse, o que
dobraria o espaçamento vertical entre parágrafos.

### 12. Testes

Novos: `src/commands/registry.test.ts` (roteamento por id, id desconhecido é no-op, ponte do editor),
`src/ui/Toolbar.test.tsx`, `src/ui/StatusBar.test.tsx`, `src/ui/useClickOutside.test.ts` (`renderHook`).

Ajustados: `ThemeToggle.test.tsx` e `HistoryPanel.test.tsx` passam a consultar por
`getByRole("button", { name: … })` / `aria-label` em vez de texto visível;
`TabBar.test.tsx` ganha o caso do ponto de não-salvo. `PreviewToggleButton.test.tsx` é apagado
junto com o componente (a cobertura migra para `Toolbar.test.tsx` + `registry.test.ts`).

Seguir o padrão já estabelecido no repo: `vi.mock("@tauri-apps/api/core")`, `useSomeStore.setState`
com actions mockadas, asserts em Vitest puro (o projeto não usa `jest-dom` nem `user-event`), nomes
de teste em português.

### 13. `DECISIONS.md`

Nova entrada `## #60 — Toolbar e status bar`, na mesma branch, registrando: a introdução de
`lucide-react` **como exceção justificada** à postura "sem dependência nova para escopo pequeno"
(6+ ícones de traço consistente a 16px não é escopo pequeno, e a lib faz tree-shaking do que é
importado); a reversão consciente da aba `▸` da #25; o registro de comandos como nova fonte única
para toolbar/menu/paleta; o achado do conflito `⌘K` × `insertLink`; e um `**Afeta:**` apontando para
#29 (tela de preferências), #32 (barra de comandos própria fora do macOS) e a issue B.

---

## Expected Outcomes

- Nenhum elemento de chrome sobreposto ao editor ou ao preview, em nenhuma largura de janela.
- Toolbar única com 6 ícones (explorador, buscar, preview, histórico, exportar, tema), todos com
  tooltip mostrando o atalho e `aria-pressed`/`aria-label` corretos.
- Status bar mostrando contagem de palavras/caracteres e estado de salvamento tri-estado.
- Indicador de não-salvo por aba.
- Preview com largura de leitura confortável (~70ch).
- `switch` de 36 linhas em `App.tsx` substituído por um registro de comandos reutilizável pela
  issue B (paleta `⌘P`) e por futuras issues (#29, #32).
- `DECISIONS.md` atualizado com a entrada #60.

---

## Risks & Considerations

- **`ConflictBanner` sai de absoluto para fluxo** — muda a altura útil do split quando aparece.
  É a intenção (não cobrir mais o texto), mas vale conferir que `useScrollSync` não se confunde:
  ele lê geometria via `getBoundingClientRect` dentro de um listener delegado em `.app-main`, que
  continua sendo o ancestral estável — não deve haver impacto.
- **Largura de leitura vaza para o export** (efeito do `?raw` da #26, `PreviewPane.css` é inlinada
  no HTML/PDF exportados). Tratado como melhoria, mas precisa de verificação visual explícita no
  export.
- **`lucide-react` no bundle** — conferir que o tree-shaking do Vite mantém só os ~7 ícones
  importados (`npm run build` e olhar o tamanho do chunk).
- **Testes que quebram são conhecidos e listados** (passo 12) — nenhuma surpresa esperada.

---

## Verification

1. `mise run lint` — ESLint + `cargo clippy -D warnings`.
2. `mise run typecheck` — `tsc --noEmit`.
3. `mise run test` — Vitest + `cargo test`.
4. **Manual, via `mise run dev`** (a postura do repo para UI: #12/#22/#23/#24/#25 registram
   verificação visual manual):
   - Nenhum botão flutuante sobrepõe o texto do editor ou do preview, em nenhuma largura de janela.
   - Os 6 ícones da toolbar disparam a mesma ação que o item equivalente do menu nativo.
   - `aria-pressed` do explorador e do preview acompanha o estado real (fechar/abrir pelo menu
     nativo `⇧⌘E`/`⇧⌘P` reflete no ícone).
   - Tooltips aparecem rápido e mostram o atalho correto.
   - Tema: o ícone muda ao escolher Sistema/Claro/Escuro; a preferência sobrevive ao restart.
   - Status bar: contagem bate com o texto; o estado percorre `Não salvo → Salvando… → Salvo` ao
     digitar e esperar o debounce de 800ms.
   - Ponto de não-salvo aparece na aba certa com múltiplas abas, e vira `×` no hover.
   - Abrir 10+ abas: elas rolam horizontalmente **sem** empurrar a toolbar para fora.
   - Preview com largura de leitura, e janela estreita não gera scroll horizontal.
   - **Regressão do export:** confirmar que HTML e PDF exportados também ganham a largura de
     leitura, e que mermaid/tabelas largas não são cortados.
   - Conflito externo: editar o arquivo por fora e confirmar que o `ConflictBanner`, agora em fluxo
     normal, empurra o conteúdo em vez de cobri-lo.

---

## Issue B (esboço, para depois do merge desta)

Milestone `v0.2` (a abrir). Consome o registro de comandos já pronto:

- **Paleta de comandos em `⌘P`** — `src/ui/CommandPalette.tsx`, busca fuzzy sobre `commands`,
  navegação por setas, `Enter` executa, `Esc` fecha. **`⌘K` está indisponível**: já é `insertLink`
  em `markdownCommands.ts:238`, e pelo achado da #24 um item de menu nativo com esse accelerator
  roubaria a tecla da WKWebView. O item de menu nativo correspondente entra em `app_menu.rs`
  (submenu Visualizar).
- **Modo foco** — mais um comando no registro (esconde toolbar, status bar e explorador), com uma
  chave nova em `settings.json` via `patchAppSettings`.
- Ambos resolvem boa parte da #32 (barra de comandos própria para Windows/Linux).

---

## Sugestões de UI/UX que ficam fora (viram issues quando o usuário quiser)

- **Índice/outline do documento** — painel lateral com os headings, clicável; reaproveita o
  `syntaxTree()` que `markdownDecorations.ts` já percorre.
- **Tela de preferências** — a issue **#29 já exige uma** ("ajuste de nível 2 vs 3 do live preview
  nas preferências do app") e ela não existe. Seria o lar natural do tema, da largura de leitura e
  do intervalo de autosave.
- **Barra de formatação markdown** — decidida como fora de escopo agora; `markdownCommands.ts` já
  expõe `toggleBold`/`toggleItalic`/`insertLink` prontos se mudar de ideia.
- **Estado vazio / boas-vindas** — hoje o app sempre força uma aba `untitled-N.md` aberta.
- **Navegação por teclado no divisor do split** — dívida de a11y registrada conscientemente na #19
  (`role="separator"` sem setas).
