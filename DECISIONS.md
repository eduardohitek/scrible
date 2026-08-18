# DECISIONS.md

Log cronológico de decisões de arquitetura tomadas por issue. Cada entrada registra o que foi decidido, por quê, e quais issues futuras isso pode afetar.

Antes de planejar uma nova issue, leia este arquivo inteiro — decisões de issues anteriores frequentemente restringem ou orientam issues futuras que dependem delas.

## #5 — Bootstrap do workspace (`~/Documents/scrible/` e `.scrible/`)

- Erro (`WorkspaceError`, `src-tauri/src/workspace.rs`): `thiserror` + `serde::Serialize`, `#[serde(tag = "kind", content = "message")]`, variantes `PermissionDenied`/`Io`.
- Paths fixos: root do usuário em `~/Documents/scrible/`; dados internos do app (não visíveis ao usuário) em `~/Documents/scrible/.scrible/`.
- Bootstrap é idempotente: `create_dir_all` + escrita/remoção de um arquivo-sonda para detectar diretórios pré-existentes sem permissão de escrita (criar o diretório não falha nesse caso — só uma escrita real revela o problema).
- Função pura (`ensure_workspace`) testável com `tempfile::tempdir()`, separada de um wrapper fino (`bootstrap`) que só resolve `document_dir()` via API do Tauri.

**Afeta:** qualquer issue que grave dados internos do app (histórico de versões `#8`, sessão `#9`) sabe que `.scrible/` é o lugar certo.

## #6 — Camada de arquivos em Rust com escrita atômica

- `FsError` (`src-tauri/src/fs_ops.rs`) é único, compartilhado pelos 5 commands (`read_file`, `save_file`, `rename_file`, `delete_file`, `list_dir`), com tag por variante (`#[serde(tag = "kind")]`) — não um enum por operação.
- `mtime` em **milissegundos** (`i64`) desde a época Unix, não segundos — granularidade de segundos seria grosseira demais para autosaves rápidos no mesmo segundo.
- Escrita atômica: grava em `<arquivo>.scrible-tmp` no mesmo diretório, `File::sync_all()` (fsync), depois `fs::rename` (atômico no mesmo filesystem). Sufixo **fixo**, não nome aleatório — decisão consciente que assume um único editor/janela escrevendo em cada arquivo por vez; revisitar se isso mudar (múltiplas janelas, mesmo arquivo).
- `save_file(path, content, expected_mtime: Option<i64>)`: se `expected_mtime` divergir do mtime atual em disco, retorna `FsError::ExternalChange { current_mtime, current_content }` sem tocar no arquivo — não sobrescreve, não faz retry automático.
- Nenhum dos 5 commands valida que `path` está dentro do workspace — decisão consciente, não descuido. Os commands operam em qualquer caminho absoluto do sistema, como um editor de texto genérico. Revisitar se o app ganhar mais superfície de ataque (plugins, conteúdo remoto, abertura de paths vindos de fora do processo).

**Afeta:** `#7` (consome `save_file`/`expected_mtime` para o autosave), `#10` (consome `ExternalChange` para o watcher de alteração externa), `#25` (consome `list_dir` para o explorador de arquivos).

## #7 — Autosave direto no arquivo original com debounce

- Escopo reduzido a **documento único** (sem abas ainda) — a issue, como escrita, pressupõe `src/store/` com estado por aba (`#9`/`#21`), que ainda não existem. `src/store/documentStore.ts` (zustand) foi desenhado para já encaixar quando `#21` vier multiplexá-lo por aba.
- Path padrão fixo: `~/Documents/scrible/untitled.md`, criado automaticamente no boot (via `read_file`/`save_file`) se ainda não existir — não há file picker nem issue de "abrir/criar arquivo" no backlog.
- Debounce de 800ms via `setTimeout` simples na store (sem lib de debounce). Gatilhos imediatos (`flush()`): blur da janela (`onFocusChanged` no JS) e fechamento do app.
- Fechamento do app: handshake `WindowEvent::CloseRequested` (Rust, `on_window_event` do `Builder`) → `api.prevent_close()` + `window.emit("app-close-requested")` → frontend escuta, chama `flush()`, e só então `invoke("quit_app")` (novo command, `app.exit(0)`) — evita perder a última alteração sem depender de um timeout arbitrário.
- `FsError::ExternalChange` (de `#6`) leva a `status: "conflict"` na store, guardando `current_mtime`/`current_content`, **sem retry automático nem sobrescrita** — fica pronto para a UI de reconciliação de `#10` consumir.
- Indicador visual "Salvando…" é um elemento fixo mínimo no `app-shell` (não na aba — `#21` não existe ainda).

**Afeta:** `#8` (decide se cria snapshot a cada save bem-sucedido), `#9` (sessão terá que substituir o path fixo por múltiplos paths persistidos e reconciliar com `documentStore`), `#10` (consome o estado `conflict`), `#21` (vai multiplexar `documentStore` por aba).

## #10 — Watcher de alteração externa e reconciliação

- Módulo `src-tauri/src/watcher.rs`, crate `notify = "6"`. Observa o **diretório pai** do arquivo (`~/Documents/scrible/`), não o arquivo diretamente — sobrevive ao arquivo ainda não existir no primeiro boot e ao rename atômico feito por qualquer programa (o próprio scrible incluído). `RecursiveMode::NonRecursive` restringe eventos aos filhos diretos do diretório, então escritas dentro de `.scrible/history/` não geram ruído.
- Supressão de eco: `LastSaveMtime` (`Arc<Mutex<Option<i64>>>`, gerenciado via `app.manage`) guarda o mtime do último `save_file` bem-sucedido do próprio scrible; o watcher ignora eventos cujo mtime em disco bate com esse valor. Não há pausa por janela de tempo — comparação de mtime é exata e não depende de latência de I/O.
- Debounce de rajadas de eventos (ex: temp+rename gera múltiplos eventos por escrita lógica) implementado inline em `watcher.rs` (buffer + 300ms de silêncio), sem adicionar `notify-debouncer-mini` como dependência nova — mesma postura de `#8`.
- Início do watch é automático no `setup()` do Rust, path fixo (`untitled.md`) — sem command start/stop, consistente com o escopo documento único de `#7`. Revisitar quando `#21` (abas) introduzir múltiplos arquivos abertos simultaneamente.
- `history::force_snapshot` (extraído de dentro de `restore_snapshot`, `#8`) é reaproveitado pelo novo command `snapshot_before_discard`: ao usuário escolher "usar versão do disco" num conflito, a versão local descartada é sempre snapshotada, bypassando o throttle de 5min.
- Frontend: novo campo `dirty: boolean` em `documentStore` (fonte única de verdade para "há edição local pendente"), `resolveConflict("mine" | "disk")` reaproveita o `status`/`conflict` já existentes de `#6`/`#7` (não um shape novo). UI: `src/conflict/ConflictBanner.tsx`, banner fixo não-modal (não um dialog bloqueante), consistente com o padrão visual de `HistoryPanel`/indicador de save.

**Afeta:** `#21` (o watcher terá que observar N arquivos, um por aba aberta, não mais um path fixo único).

## #8 — Snapshots de histórico de versões (registrado retroativamente)

- Throttle de 5 minutos (`THROTTLE_MS`, `src-tauri/src/history.rs`), contado a partir do save bem-sucedido: `maybe_snapshot` só cria um novo snapshot se passaram ≥5min desde o último **e** o conteúdo mudou em relação a ele — evita um snapshot por autosave de 800ms.
- Hash do path do arquivo via **FNV-1a inline** (não `std::collections::hash_map::DefaultHasher`, cujo algoritmo não é garantido estável entre versões do Rust; não uma nova dependência) — determina o diretório de snapshots (`.scrible/history/<hash>/`).
- Comparação de "conteúdo mudou" é feita contra o **conteúdo completo** do último snapshot, não um diff/hash parcial.
- Retenção FIFO de `MAX_SNAPSHOTS = 20` por arquivo.
- `restore_snapshot` **força** um snapshot do conteúdo atual (bypassando o throttle) antes de sobrescrever com a versão restaurada — preserva a versão que seria descartada. Esse é o único ponto que fura o throttle hoje.
- UI (`src/history/HistoryPanel.tsx`): painel fixo (canto superior direito) acionado por um botão de toggle, fecha ao clicar fora (`mousedown` no `document` comparado contra um `ref` do container).

**Afeta:** `#10` (reaproveita o padrão de "forçar snapshot bypassando throttle" de `restore_snapshot` para a versão descartada num conflito), `#21` (diretório de snapshots já é por path, então multiplexar por aba não exige mudança no `history.rs`), `#25` (exclusão de arquivo pelo explorador pode se apoiar no histórico como rede de segurança parcial).

## #12 — Preview inline nível 2 (marcadores visíveis + texto estilizado)

- CSS ad hoc agora (cores/tamanhos hardcoded via `light-dark()` em `App.css`), **sem esperar** a `#22` (design system/tokens) — decisão via sabatina: `#12` só depende de `#11`/`#1` (ambas fechadas), não de `#22`, e bloquear quebraria o fluxo de "uma issue por vez conforme dependências declaradas". `#22`, quando implementada, deve revisitar essas regras e migrar para tokens formais.
- `src/editor/markdownDecorations.ts` (novo módulo, não dentro de `EditorPane.tsx`): um único `ViewPlugin` que usa `syntaxTree()` (de `@codemirror/language`, adicionada como dependência direta — antes só transitiva via `@codemirror/lang-markdown`) restrito a `view.visibleRanges` (não o documento inteiro) para performance em documentos grandes.
- Dois grupos de classe CSS: um dicionário nó→classe para o conteúdo semântico (`cm-md-h1`..`h6`, `cm-md-strong`, `cm-md-em`, `cm-md-strike`, `cm-md-inline-code`, `cm-md-fenced-code`, `cm-md-link`) e uma classe única compartilhada `cm-md-marker` (opacidade reduzida) para todos os nós de marcador (`HeaderMark`, `EmphasisMark`, `CodeMark`, `StrikethroughMark`, `LinkMark`) — os marcadores nunca são removidos do DOM/conteúdo, só estilizados.
- `FencedCode` recebe só fonte monoespaçada + fundo no bloco inteiro — **sem** syntax highlighting por linguagem (fora de escopo desta issue).
- **Sem teste automatizado dedicado** para a lógica de decoration — decisão consciente do usuário via sabatina, primeira issue do projeto sem testes unitários próprios; verificação ficou só manual (`mise run dev`). Revisitar se `#13`/`#14`/`#15` (demais issues do editor) precisarem estender `markdownDecorations.ts` — pode valer a pena introduzir o padrão de teste headless de `EditorState`/`EditorView` (sem precedente no repo) nessa hora.

**Afeta:** `#22` (vai herdar/substituir as cores hardcoded aqui por tokens formais), `#13`/`#14`/`#15` (issues seguintes do editor, que podem reaproveitar ou estender `src/editor/markdownDecorations.ts`).

## #13 — Autocomplete grupo A (comportamentos automáticos de digitação)

- `markdown()` em `EditorPane.tsx` passou a usar `base: markdownLanguage` (GFM) em vez do
  `commonmarkLanguage` default — corrige a decoration de `Strikethrough` da `#12`, que era código
  morto (o nó nunca era produzido sem GFM), e habilita `Task`/`TaskMarker` para uso futuro.
- Continuação/encerramento de lista no Enter (requisitos 1 e 2 da issue) **não foram
  reimplementados** — já vêm de graça de `markdownKeymap`/`insertNewlineContinueMarkup`, que
  `markdown()` já instala por padrão (`addKeymap: true`) com `Prec.high`. Comportamento real
  confirmado por teste: item vazio único remove o marcador imediatamente; item vazio que não é o
  primeiro da lista precisa de **dois Enters** (o primeiro insere linha em branco/afrouxa a lista,
  o segundo remove o marcador) — bate com o texto da própria issue ("dois Enters seguidos
  encerram").
- Tab/Shift-Tab (`src/editor/markdownCommands.ts`, `listIndent`/`listOutdent`): alinhamento
  dinâmico correto (coluna de conteúdo real do item vizinho, via regex sobre o texto da linha —
  não há API pública no lezer-markdown para isso). Reindentam **só a linha do item** (não outras
  linhas de um item multi-linha) e renumeram **só o item movido** — não recalculam em cascata os
  irmãos afetados pela mudança de nível. Sem item-irmão/item-pai aplicável, os comandos não fazem
  nada (`false`, sem side-effect).
- Envolver seleção ao digitar `*`/`_`/`` ` `` usa o par de 1 caractere; `~` é a única exceção e
  dobra para `~~texto~~` — riscado GFM exige o par duplo, um `~` só não é sintaxe válida.
- Todo comando novo despacha com `userEvent: "input"` e **um único `dispatch()` por invocação** —
  é isso (não o valor de `userEvent` sozinho) que garante 1 entrada de histórico por ação;
  `userEvent: "input.type"` seria fundido pelo merge automático do `history()`.
- Primeiro precedente de teste no repo que monta `EditorState` isolado (fora de componente React) —
  `src/editor/markdownCommands.test.ts`. Útil de referência para `#14`/`#15` (demais issues do
  editor) se precisarem do mesmo padrão.

**Afeta:** `#14`/`#15` (podem reaproveitar `src/editor/markdownCommands.ts` e o padrão de teste
headless de `EditorState`), `#22`/`#23` (a base GFM já habilitada aqui vale para qualquer
decoration/comportamento futuro que dependa de `Task`/`TaskMarker`).

## #45 — Editor não sincroniza conteúdo quando muda por fora da digitação (bug)

- Causa raiz: `EditorPane.tsx` criava o `EditorView` num `useEffect` com deps vazias — o `doc`
  inicial só era gravado uma vez, na montagem. Mudanças em `value` depois disso (load assíncrono
  do `documentStore.init()`, restauração de histórico via `applyExternalContent`, reload silencioso
  do watcher `#10`) nunca eram propagadas pro CodeMirror — o preview atualizava (reage à prop
  normalmente), o editor ficava travado no conteúdo do primeiro render.
- Fix: novo `useEffect(() => {...}, [value])` separado do de montagem — despacha uma transação de
  substituição total do doc quando `value` diverge do doc atual do `EditorView` (via `viewRef`).
  Sem lógica especial pra "pular a primeira execução": como o efeito de montagem já grava o doc
  inicial com esse mesmo `value`, a checagem de igualdade já é um no-op na primeira renderização.
- A transação de sincronização é despachada **sem** `Transaction.userEvent`. O
  `EditorView.updateListener` foi ajustado para só chamar `onChange` (→ `store.setContent` →
  `dirty: true` + reagenda autosave) quando a transação que mudou o doc tiver alguma anotação de
  `userEvent` — digitação, paste, undo/redo e os comandos de `#13` já despacham com
  `userEvent: "input"`/"input.type"/etc.; a sincronização programática não tem nenhuma. Sem esse
  filtro, sincronizar a prop reacenderia `dirty`/autosave sempre que `applyExternalContent` tivesse
  acabado de zerar `dirty` — reintroduziria o tipo de save espúrio que `#6`/`#7`/`#10` foram
  desenhados pra evitar.
- Primeiro teste RTL (`@testing-library/react`) do `EditorPane` — `src/editor/EditorPane.test.tsx`,
  cobrindo tanto a sincronização visual quanto a ausência de `onChange` espúrio.

**Afeta:** `#21` (barra de abas) — agora que `EditorPane` reage a mudanças externas de `value`, a
troca de aba pode não precisar mais remontar o componente inteiro por `key`; vale reavaliar esse
ponto do design de `#21` quando chegar a vez dela.

## #14 — Autocomplete grupo B (menu de comandos com `/`)

- Novo módulo `src/editor/slashMenu.ts`: `autocompletion({ override: [slashCommandSource], icons: false })`
  do `@codemirror/autocomplete` (já era dependência instalada desde `#11`, nunca usada até aqui).
  `override` restringe a fonte ativa só ao menu `/` — não completa palavras genéricas.
- Cada item da lista (Tabela, Bloco de código, Diagrama mermaid, Lista de tarefas, Citação, Link,
  Imagem, Cabeçalho 1/2/3, Linha horizontal) é um `snippetCompletion` com tabstops `${...}` —
  posicionamento do cursor e navegação Tab entre campos vêm de graça do `snippet()` da lib (registra
  seu próprio keymap em `Prec.highest` só quando um snippet com campos está ativo). Cabeçalhos H1-H3
  são 3 itens planos, não um submenu — decisão via sabatina, desproporcional criar um segundo nível
  de `CompletionSource` para 3 opções (diferente do fluxo de tipos de diagrama mermaid da `#15`, que
  de fato precisa de dois níveis).
- `slashCommandSource` só dispara com `/` no início de uma linha (prefixo antes do `/` na linha
  precisa ser só espaços — cobre o caso "e/ou" do AC) **e** fora de blocos de código com fence
  (checagem via `syntaxTree().resolveInner` subindo até achar `FencedCode`/`CodeBlock`, mesmo padrão
  de `markdownCommands.ts`/`markdownDecorations.ts`) — decisão via sabatina, vai além do AC literal
  para evitar o falso positivo real de colar um script shell com linhas `/algo` dentro de um fence.
- Item "Bloco de código" insere um fence **sem** campo de linguagem (` ``` \n${código}\n``` `) —
  decisão via sabatina: a escolha de linguagem em si é escopo da `#15`. Mesma lógica para "Diagrama
  mermaid": esqueleto mínimo de um `flowchart` só, sem o seletor dos 7 tipos de diagrama (`#15`).
- **Armadilha real, encontrada só na verificação manual** (os testes headless do `CompletionSource`
  isolado não pegaram, porque não exercitam o pipeline completo de filtragem do CM6): `from` do
  `CompletionResult` precisa incluir o próprio `/` (é ele quem devia ser apagado ao aceitar o item),
  mas o matcher default do CM6 filtra as opções comparando o label contra `sliceDoc(from, to)` — que
  então sempre começa com `/`, e nenhum label bate. Resultado: o menu nunca abria (zero opções em
  qualquer estado, mesmo digitando só `/`), embora `slashCommandSource` chamado isoladamente
  retornasse a lista completa normalmente. Fix: `filter: false` + filtragem manual dentro da própria
  fonte, comparando o texto digitado _depois_ do `/` (`sliceDoc(word.from + 1, word.to)`) contra os
  labels. Reproduzido/confirmado com um `EditorView` real em jsdom (`view.dispatch` simulando
  `userEvent: "input.type"` + aguardar os timers internos do plugin), não só com `EditorState`
  isolado — vale considerar esse tipo de teste (headless, mas com `EditorView` de verdade) para
  qualquer futura fonte de `autocompletion()` com trigger char próprio (`#15` vai precisar disso
  para ` ``` `).
- Fechar com `Esc`/clique fora e aceitar com `Enter` são o `completionKeymap` embutido em
  `autocompletion()` (`Prec.highest`, sem precisar registrar keymap próprio nem entrar em conflito
  com o `Tab`/`Shift-Tab` de `listIndent`/`listOutdent` de `#13` — o `/` nunca dispara dentro de um
  item de lista, cujo prefixo de linha nunca é whitespace-only).
- Testes (`src/editor/slashMenu.test.ts`) reaproveitam o padrão headless de `EditorState` de `#13`:
  chamam `slashCommandSource` diretamente com um `CompletionContext` construído à mão, e para validar
  a inserção chamam a `apply` de `snippetCompletion` com um "fake editor" (`{ state, dispatch }`) —
  a assinatura de `apply` só usa essas duas propriedades, dispensando um `EditorView` real.

**Afeta:** `#15` (grupo D) reaproveita `syntaxTree()`/checagem de posição em fence já presente aqui
e o padrão de `snippetCompletion`/tabstops para os esqueletos de mermaid; herda a decisão de que o
item "Bloco de código" desta issue fica sem linguagem — `#15` é quem resolve isso via fence real.

## #22 — Design system e tokens de tema

- Novo `src/theme/tokens.css` (custom properties só, sem seletores além de `:root`), importado em
  `App.tsx` antes de `App.css`. `App.css` continua sendo a única folha de estilo de componentes —
  sem migração para CSS Modules/PostCSS/Tailwind, decisão via sabatina.
- Todo token de cor usa `light-dark(claro, escuro)` diretamente na custom property (ex.:
  `--color-border: light-dark(#ddd, #444)`), apoiado no `color-scheme: light dark` já existente em
  `:root` — decisão via sabatina: nenhum `@media (prefers-color-scheme)`/`[data-theme]` agora, isso é
  escopo da `#23`; como o override futuro da `#23` vai atuar só sobre `color-scheme` num escopo mais
  específico, `light-dark()` já compõe corretamente sem retrabalho.
- `--color-accent` reaproveita a cor de link já existente (`#0969da`/`#58a6ff`, cores de link do
  GitHub Primer) como accent único do app — sem uma segunda cor de destaque.
- Consolidação de duplicação: `.mermaid-error`/`.workspace-error` tinham os mesmos hexadecimais
  hardcoded (`#b00020`/`#fdecea`) sem `light-dark()` (bug pré-existente, ilegível em dark mode) —
  viraram `--color-danger-*` com variantes escuras novas, consumidos independentemente pelas duas
  classes (sem fundir os componentes).
- Bordas quase-duplicadas (`#e0e0e0`/`#ddd`/`#eee` em `.editor-pane`/`.history-toggle`/
  `.history-panel`/`.history-item`) foram unificadas em dois tokens por semântica de uso, não por
  coincidência de valor: `--color-border` (chrome flutuante/interativo: toggle, painel) e
  `--color-border-subtle` (divisores em fluxo: borda do editor, linhas da lista de histórico) — o
  agrupamento seguiu o valor do modo escuro (`#333` vs `#444`), que divergia mais entre os dois
  grupos do que o valor do modo claro (quase idêntico nos três).
- Tokens semânticos de markdown (`--color-markdown-heading`, `--color-markdown-code-bg`,
  `--color-markdown-link`, `--color-markdown-quote`) criados por completude do escopo mínimo da
  issue; `heading`/`link` são aliases sem efeito visual novo (headings já usavam a cor de texto
  padrão, link já era o accent). `--color-markdown-quote` fica **sem consumidor** por enquanto —
  `markdownDecorations.ts` não tem decoration de blockquote ainda.
- CodeMirror: novo `src/editor/editorTheme.ts`, um único `EditorView.theme()` cobrindo seleção,
  cursor e o tooltip do `autocompletion()` de `slashMenu.ts` (`#14`) — via `var(--token)` direto nos
  valores do spec object, porque CodeMirror injeta essas três coisas com seu próprio `baseTheme()` e
  uma regra solta em `App.css` não teria precedência garantida sobre ele. Fonte/tamanho do editor
  continuam vindo de `.editor-pane .cm-editor` em `App.css` (cascata normal já funcionava para isso).
- `mermaid.initialize({ theme: "default" })` (`PreviewPane.tsx`) **não foi tocado** — é conteúdo de
  markdown (fora do escopo pelo próprio texto da issue) e depende de detecção de tema em runtime, que
  é escopo da `#23`. `.mermaid-error` (banner de erro do scrible, não conteúdo do mermaid em si) já
  está nos tokens de perigo.
- Boilerplate do Tauri/Vite em `index.html` (título, favicon) — fora de escopo, não é token de design.
- Sem teste automatizado dedicado (mesma decisão da `#12`) — verificação só manual via `mise run dev`
  com toggle de aparência do macOS, aprovada visualmente pelo usuário conforme o critério de aceite.

**Afeta:** `#23` (mecanismo de troca de tema manual/`matchMedia` consome os mesmos tokens, sem
retrabalho pela composabilidade de `light-dark()`), demais issues de UI (abas, menus) que agora têm
tokens prontos para consumir em vez de hardcodar cores novas.

## #23 — Tema claro/escuro com opção de seguir o sistema

- Override de `color-scheme` por preferência fixada (`:root[data-theme="light"|"dark"]`) vive em
  `App.css`, ao lado do `color-scheme: light dark` que já estava lá — **não** em `tokens.css`, que
  continua restrito a `#22` ("custom properties só, sem seletores além de `:root`"). `light-dark()`
  já compõe com esse `color-scheme` mais específico sem nenhuma mudança nos tokens.
- Persistência em `.scrible/settings.json` (`{"theme": "system"|"light"|"dark"}`) reaproveita os
  commands Rust genéricos já existentes `read_file`/`save_file` (`#6`, sem validação de path) — sem
  criar nenhum command novo. Efeito colateral aceito conscientemente: `save_file` sempre chama
  `history::maybe_snapshot`, então toda troca de tema também gera uma entrada (nunca exposta na UI)
  em `.scrible/history/<hash-do-path-de-settings.json>/`; custo desprezível dado o throttle de 5min
  de `#8`.
  Também aceito conscientemente: `settings.json` é gravado com overwrite completo (sem
  read-merge-write), seguro hoje porque `theme` é o único campo. **A próxima feature que adicionar
  uma segunda chave nesse arquivo precisa migrar para leitura+merge antes de escrever, ou vai apagar
  o campo `theme` (ou vice-versa) silenciosamente.**
- Novo `src/theme/themeStore.ts` (zustand, mesmo padrão de `init()`/tratamento de `FsError.NotFound`
  de `documentStore.ts`): `preference` (persistido) + `resolved` (derivado via `matchMedia`, nunca
  `"system"`). O listener de `matchMedia("(prefers-color-scheme: dark)")` só existe enquanto
  `preference === "system"` — uma única função (`applyPreference`) decide isso tanto em `init()`
  quanto em `setPreference()`, evitando a corrida entre uma mudança de tema do SO em segundo plano e
  uma troca manual do usuário. O estado inicial da store é estático (sem chamar `matchMedia` na
  criação) porque `PreviewPane.tsx` importa `themeStore.ts` e `jsdom`/`vitest` não implementa
  `matchMedia` — só `init()` e o que ele aciona podem tocar nisso.
- `document.documentElement.dataset.theme = resolved` (não um wrapper React) é o único ponto que
  aplica o tema — é o que `:root[data-theme=...]` alcança. Aplicado sempre, mesmo com preferência
  `"system"` (nesse caso `resolved` já é o valor concreto vindo da resolução via `matchMedia`).
- `PreviewPane.tsx`: `mermaid.initialize` deixou de ser uma chamada única em module scope e passou a
  rodar dentro do efeito que processa os blocos mermaid, dependente de `[html, resolved]`. Precisou
  parar de usar `dangerouslySetInnerHTML` no JSX — o próprio efeito reescreve
  `container.innerHTML = html` antes de reprocessar os blocos, porque diagramas já renderizados como
  SVG substituem o `<pre><code>` original no DOM real, e sem essa reescrita eles não seriam
  encontrados de novo para redesenhar num novo tema. Um guard `cancelled` (setado no cleanup)
  evita que uma promise de `mermaid.render` de uma execução antiga escreva no DOM depois que um
  efeito mais novo já reescreveu o container.
- Sem teste automatizado para o wiring de `data-theme` em `App.tsx` (não existe `App.test.tsx`) —
  mesma postura de `#12`/`#22` para esse tipo de integração de tema/CSS; verificação só manual via
  `mise run dev`.
- Resíduo aceito conscientemente: como `init()` do tema é assíncrono (round-trip IPC), há uma janela
  breve de "flash de tema errado" (FOUC) só quando a preferência manual salva diverge do tema atual
  do SO no boot — no caso `"system"` (default) não há flash, porque `color-scheme: light dark` já
  resolve nativamente no primeiro paint. Eliminar isso exigiria uma segunda fonte de verdade síncrona
  (ex: `localStorage`) — fora de escopo.
- `src/theme/ThemeToggle.tsx`: dropdown de 3 opções explícitas (Sistema/Claro/Escuro), não um botão
  de ciclo único — mostra o estado atual sem exigir interação. Mesmo padrão de interação de
  `HistoryPanel.tsx` (toggle + fecha ao clicar fora via `mousedown` em `document`).

## #17 — Pipeline markdown-it: GFM + front matter + footnotes + sanitização

- Confirmado por leitura do código-fonte do `markdown-it`: sem `preset` explícito no construtor
  (`new MarkdownIt({ html: false, linkify: true })`), o preset **default** já habilita tabelas e
  texto riscado GFM — só o preset `commonmark` os desabilitaria. O scaffold anterior (`#12`/`#22`)
  já tinha isso de graça; o trabalho real desta issue foi listas de tarefas, front matter e debounce.
- **Front matter não usa o plugin `markdown-it-front-matter`** (desvio consciente do plano original):
  o plugin captura o bloco via callback síncrono que precisa mutar uma variável de módulo dentro do
  `md.render()`; como esse `render()` roda dentro do `useMemo` de `PreviewPane`, isso violava a regra
  de pureza do `eslint-plugin-react-hooks` ("Reassigning this value during render is a form of side
  effect"). Solução: `extractFrontMatter` faz o parsing do bloco `---...---` manualmente, isolando-o
  do corpo _antes_ de chamar `md.render()` — sem plugin, sem estado de módulo mutável, e mais simples
  no fim das contas.
- Front matter é parseado com um line parser artesanal (`key: value`, split no primeiro `:`, com
  suporte só a valores entre aspas simples/duplas) — **não** `js-yaml`. O critério de aceite da issue
  só exige um bloco plano (`title: Teste`); a convenção já estabelecida no projeto (debounce manual
  em `#7`, throttle manual em `#8`, FNV-1a inline em `#8`) favorece não adicionar uma dependência de
  parser completo para esse escopo. Revisitar se algum front matter aninhado/lista aparecer no
  futuro.
- Valores de front matter são escapados manualmente (`escapeHtml`) antes de virar `<td>` — tratados
  como texto literal, nunca como markdown. A tabela de metadados resultante é concatenada com o corpo
  **antes** da única chamada a `DOMPurify.sanitize` já existente; não há caminho de sanitização
  paralelo/alternativo para o bloco de metadados.
- `markdown-it-task-lists` (sem tipos publicados, mesmo padrão de `@ts-expect-error` já usado para
  `markdown-it-footnote`) — checkboxes ficam **desabilitados** (comportamento default do plugin):
  decisão consciente, o preview é somente leitura e não há wiring de volta para o documento fonte.
- Debounce de render (`RENDER_DEBOUNCE_MS = 200`, dentro da faixa 150-300ms pedida): estado
  `debouncedSource` local ao componente (`useState` + `useRef` para o timer), mesmo idioma manual
  `setTimeout`/`clearTimeout` de `documentStore.ts` (`#7`), só que por instância de componente (não
  módulo) — já é seguro para múltiplas instâncias futuras de `PreviewPane` (ex: abas, `#21`). Um
  guard de "primeira execução" evita atrasar o primeiro paint; só mudanças subsequentes de `source`
  são debounced. `html` continua um `useMemo` puro, agora derivado de `debouncedSource` em vez de
  `source` diretamente.
- Verificação manual via `mise run dev` **não foi feita nesta sessão** — porta 1420 já estava em uso
  por outra sessão concorrente no mesmo host. Cobertura ficou só nos testes automatizados (11 casos
  novos em `PreviewPane.test.tsx` cobrindo tabela, task list, riscado, nota de rodapé, front
  matter→tabela, sanitização do front matter, e debounce com fake timers). Recomenda-se conferência
  visual manual antes de considerar a issue definitivamente encerrada.

**Afeta:** `#18` (isolamento de erro de mermaid, cujo código já existe em `PreviewPane.tsx` desde o
scaffold — só falta a issue formal), `#19`/`#20` (layout split e scroll sync, que devem derivar
qualquer novo estado de `debouncedSource`, não de `source` bruto, para preservar a garantia do
debounce), `#26`/`#27` (export HTML/PDF reaproveitam este pipeline como fonte da verdade).
