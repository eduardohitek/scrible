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

## #18 — Renderização de diagramas mermaid com isolamento de erro

- **Nenhuma mudança em `PreviewPane.tsx`**: a renderização assíncrona por bloco, o isolamento de
  erro (`.mermaid-error` por diagrama, sem afetar os vizinhos) e a reação a troca de tema já
  existiam desde o scaffold original (`#1`/`#2`) e seguiam intactos após `#17`/`#23`. O trabalho
  real desta issue foi fechar a lacuna de verificação, não implementar produção nova.
- Achado: o ambiente de teste (`jsdom`, via Vitest) não implementa `getBBox`/`getComputedTextLength`
  em elementos SVG — APIs que o mermaid usa para medir/posicionar nós e texto no layout. Sem elas,
  `mermaid.render()` lança exceção para **qualquer** diagrama, válido ou não, sob jsdom — o teste de
  isolamento de erro de `#17` só passava por coincidência (usa um diagrama propositalmente inválido,
  que já lançaria de qualquer forma). Não era possível provar que um diagrama válido de fato
  renderiza como SVG, critério de aceite literal da issue.
- Novo `src/test-setup.ts` (registrado via `test.setupFiles` em `vite.config.ts`, afeta toda a
  suíte) faz stub dessas duas APIs em `SVGElement.prototype` — **não** em `SVGGraphicsElement`/
  `SVGTextContentElement`, os donos "corretos" pela spec do DOM. Motivo: jsdom instancia elementos
  SVG sem interface dedicada (`<text>`, `<g>`, etc.) genericamente como `SVGElement` puro, não como
  as subclasses especializadas — confirmado lendo a cadeia de protótipos de um `<text>` real
  renderizado por jsdom. Usar as classes "certas" pela spec resultava em `text.getBBox is not a
function` em runtime, apesar de compilar.
- Com os stubs, os 3 critérios de aceite antes não-verificáveis viraram testes reais em
  `PreviewPane.test.tsx`: diagrama válido renderiza `<svg>` dentro de `.mermaid-diagram`; 2 diagramas
  válidos + 1 inválido no meio isolam corretamente (2 SVGs + 1 `.mermaid-error`); diagrama com 32 nós
  renderiza com sucesso sem lançar.
- **Sem debounce dedicado para mermaid** (decisão consciente, não omissão): o `useEffect` de mermaid
  já depende de `[html, resolvedTheme]`, e `html` já deriva de `debouncedSource`
  (`RENDER_DEBOUNCE_MS = 200`, `#17`) — toda edição de texto, o cenário dominante de "digitar
  rapidamente com diagramas grandes", já está protegida. O único gatilho sem debounce é troca de
  tema, uma ação discreta e pouco frequente do usuário, não um evento de disparo rápido repetido
  como digitação — não justificou um segundo timer.

**Afeta:** `#26`/`#27` (export HTML/PDF podem reaproveitar `src/test-setup.ts` para testar
embutimento de SVG mermaid), `#20` (scroll sync deve estar ciente de que diagramas grandes recalculam
altura de forma assíncrona, depois do primeiro paint).

## #21 — Barra de abas: abrir, fechar, reordenar, renomear

- **Nenhuma mudança no backend Rust.** `rename_file`/`list_dir` (`#6`) já eram genéricos o
  suficiente — `rename_file(from, to)` não sabe o que é "aba", e `list_dir` (nomes de entrada,
  não paths completos) já serve para checar colisão de `untitled-N.md` contra o conteúdo real do
  workspace. `history.rs` também não mudou: o diretório de snapshot já era por hash do path
  inteiro, então múltiplas abas simultâneas já produziam histórico isolado de graça (antecipado em
  `#8`).
- `documentStore.ts` generalizou de um documento único (`path` fixo) para
  `documents: Record<tabId, DocumentEntry>`. O debounce de autosave, que era uma única variável de
  módulo (`debounceTimer`), virou `Map<tabId, timer>` — cada aba tem seu próprio timer
  independente, testado explicitamente (`setContent` numa aba não cancela nem adia o debounce de
  outra). Nova `tabsStore.ts` cuida de ordem/título/aba ativa/navegação, delegando save/conteúdo/
  conflito ao `documentStore` via `tabId`.
- **Dívida consciente do watcher**: `watcher.rs` continua observando só o path fixo original
  (`root/untitled.md`, decisão de `#7`/`#10`) — não foi generalizado para N paths nesta issue
  (escopo grande demais para uma mudança de Rust não-trivial: thread, closure, evento com
  identificador de arquivo). O evento `external-file-changed` (que não carrega path no payload) é
  roteado em `App.tsx` só para a aba aberta cujo `path` bate exatamente com esse path fixo; se
  nenhuma aba aberta bater (ex.: foi renomeada, ou o usuário nunca abriu esse arquivo), o evento é
  silenciosamente ignorado. **Revisitar numa issue futura dedicada** — reconciliação de alteração
  externa hoje só funciona para no máximo uma aba por vez.
- Arquitetura do editor: um único `EditorView` compartilhado entre todas as abas — trocar de aba
  não remonta `EditorPane`, só troca o `EditorState` via `view.setState()` (novo
  `src/editor/editorStateRegistry.ts`, cache de `EditorState`/scrollTop por `tabId` fora do estado
  React). Isso preserva undo/redo e seleção nativamente por aba, algo que remontar o componente
  perderia. `EditorPane` persiste o estado/scroll da aba de saída no registry antes de trocar
  (`saveEditorState`/`saveScrollTop`) — é isso que evita que a reconciliação de conteúdo (usada só
  para abas em segundo plano que mudaram por fora, ex. conflito resolvido enquanto não estavam em
  foco) dispare numa troca de aba comum, o que poluiria o histórico de undo com uma transação de
  "substituir doc inteiro" desnecessária.
- **Rename e histórico**: renomear uma aba muda o `path`, e o hash FNV-1a do diretório de
  histórico (`history.rs::hash_path`) muda junto — snapshots anteriores ao rename ficam órfãos sob
  o hash do path antigo, sem migração. Aceito conscientemente (mesmo comportamento de `mv` no
  Unix: metadados de uma ferramenta não seguem o arquivo automaticamente).
- **Abrir arquivo**: só a action `openTab(path)` foi implementada (com dedup — path já aberto só
  foca a aba existente), sem nenhum gatilho de UI nesta issue. Os dois gatilhos reais previstos no
  texto da issue (Cmd+O nativo, `#24`; clique no explorador, `#25`) ainda não existem — ambos
  dependem de `#21` e vão chamar `openTab` quando chegarem. Verificação manual de "abrir múltiplos
  arquivos existentes" fica adiada para lá.
- Nome de aba nova (Cmd+T ou fechar a última aba): `untitled-N.md` incremental, primeiro nome
  livre checado contra `list_dir` do workspace root (não só as abas abertas em memória) — evita
  colidir com um `untitled-1.md` deixado de uma sessão anterior.
- Fechar a última aba nunca deixa `tabs` vazio — abre automaticamente uma `untitled-N.md` nova.
  Consequência: `App.tsx` nunca precisa tratar um estado "sem aba ativa" além do instante inicial
  antes do bootstrap resolver.
- Drag-and-drop de reordenação: HTML5 nativo (`draggable`/`onDragStart`/`onDragOver`/`onDrop`) com
  o índice de origem guardado em estado local do componente — **sem** usar
  `event.dataTransfer.setData`/`getData` (não precisou, já que a troca acontece toda dentro do
  mesmo componente React) e **sem** lib nova (`@dnd-kit` etc. descartado), mesma postura de evitar
  dependência nova para escopo pequeno já usada em `#7`/`#8`/`#17`.
- Persistência da lista de abas entre reinícios do app é explicitamente escopo de `#9` —
  `tabsStore` vive só em memória, sem `session.json`.

**Afeta:** `#9` (sessão) vai persistir/restaurar `tabsStore.tabs`/`activeTabId`, incluindo
`cursorPos`/`scrollTop` — hoje só vivem em `editorStateRegistry.ts`, fora de qualquer store
serializável, então `#9` precisa decidir como extrair essa posição do `EditorState` na hora de
persistir. `#24` (menu nativo) e `#25` (explorador) chamam `tabsStore.openTab`/`newTab` como os
gatilhos de UI que faltam aqui. Qualquer issue futura de watcher multi-path deve substituir o
roteamento por-path-fixo em `App.tsx` por algo que cubra todas as abas abertas.

### Bugfix pós-merge: `EditorView` morta sob `React.StrictMode` (só em `mise run dev`)

Reportado pelo usuário logo após o merge: em `mise run dev`, o conteúdo do arquivo não carregava
no editor e não era possível digitar em nenhuma aba (nem a inicial, nem uma nova) — mas todos os
113 testes e a verificação de `mise run dev` (só checando os logs de boot) tinham passado. Causa:
`main.tsx` envolve `<App />` em `<React.StrictMode>`, que em dev faz o React invocar os efeitos de
montagem duas vezes (`monta → limpa → monta de novo`) para expor bugs de efeito com side-effect
não idempotente. O efeito de montagem do `EditorPane` (`[tabId]`) decide criar uma `EditorView`
nova só quando `!viewRef.current`; um efeito **separado**, só de montagem (`[]`), destrói essa
`EditorView` no cleanup — mas nunca zerava `viewRef.current` depois do `destroy()`. No ciclo de
double-invoke do StrictMode, isso deixava `viewRef.current` apontando para uma `EditorView` já
destruída; a segunda montagem via `!viewRef.current` como verdadeiro (a ref não é `null`) e caía
no ramo `view.setState(...)` sobre uma view morta, em vez de criar uma nova — o editor ficava sem
nenhuma `EditorView` viva de fato. Corrigido zerando `viewRef.current = null` no cleanup que
destrói a view (`EditorPane.tsx`). Como o double-invoke do StrictMode só acontece em
desenvolvimento (não em builds de produção nem em testes que não envolvem `<StrictMode>`
explicitamente), nenhum teste existente pegava isso — os 113 testes originais renderizavam
`EditorPane` "nu", sem o wrapper. Teste de regressão adicionado em `EditorPane.test.tsx`
envolvendo o componente em `<StrictMode>` explicitamente e verificando que a `EditorView`
resultante ainda aceita conteúdo/digitação — confirmado que falha sem o fix e passa com ele.
**Lição geral:** qualquer efeito que crie/destrua um recurso imperativo fora do React (como um
`EditorView`) precisa zerar a ref no cleanup que destrói, não só no efeito que cria — caso
contrário o double-invoke do StrictMode (ou qualquer remontagem real) vê uma ref "preenchida mas
morta" e pula a recriação.

## #19 — Layout split redimensionável com toggle do preview

- **`src/settings/appSettings.ts`** (novo módulo de infraestrutura, não uma store zustand): fecha o
  loop do aviso já registrado em `#22`/`#23` — `themeStore.ts` gravava `settings.json` com
  **overwrite completo** (só `{ theme }`), e `#19` precisava adicionar um segundo campo (`layout`)
  no mesmo arquivo. Decisão via sabatina: em vez de `layoutStore.ts` fazer seu próprio
  read-merge-write independente, `themeStore.ts` e `layoutStore.ts` passaram a delegar todo IO a
  este módulo compartilhado. Motivo: um `layoutStore.ts` independente **não eliminaria** a race
  mais perigosa, que não é a escrita interativa (rara, sequencial), e sim o **boot concorrente** —
  dois `init()` (tema e layout) disparados quase juntos no boot do app, contra um arquivo que ainda
  não existe, poderiam cada um decidir "não existe, vou criar só com meu campo" e um apagaria o
  outro. `loadAppSettings()` memoiza a leitura inicial (chamadas concorrentes reaproveitam a mesma
  promise) e `patchAppSettings(patch)` serializa as escritas numa fila (`writeQueue`), sempre
  gravando o cache mais recente com todos os patches já aplicados.
- `AppSettings` ganhou `layout: { splitRatio: number; previewVisible: boolean }` ao lado de
  `theme`. Defaults (`splitRatio: 0.5, previewVisible: true`) preservam o comportamento visual do
  split fixo 50/50 que existia antes desta issue.
- `themeStore.ts` perdeu o campo `settingsPath` do seu estado (não precisa mais saber o path do
  arquivo — isso agora é interno a `appSettings.ts`) e passou a chamar `loadAppSettings()`/
  `patchAppSettings({ theme })` em vez de `invoke("read_file"/"save_file")` diretamente.
  `themeStore.test.ts`/`ThemeToggle.test.tsx` precisaram ser atualizados (asserções de `save_file`
  agora incluem `layout`; testes de `themeStore` passaram a usar `vi.resetModules()` + import
  dinâmico por teste, já que `appSettings.ts` guarda cache em escopo de módulo compartilhado entre
  os testes de um mesmo arquivo).
- **Unidade do split**: `splitRatio` (fração 0–1), não pixels — decisão via sabatina. CSS usa
  `flex-basis` percentual (`calc(var(--split-ratio, 0.5) * 100%)`) + `min-width` fixo
  (`--pane-min-width`, espelhando `MIN_PANE_WIDTH_PX = 240` em `src/layout/constants.ts`) — ao
  redimensionar a janela do SO, os painéis escalam proporcionalmente sem re-clamp em JS.
  `flex-grow: 1` em **ambos** os painéis (não `flex: 0 0 ...`) é o que faz o toggle do preview
  funcionar sem CSS condicional: quando `.preview-pane` não é renderizado, `.editor-pane` (único
  item com `flex-grow`) absorve 100% do espaço automaticamente.
- Mecânica do drag (`src/layout/SplitLayout.tsx`): durante o arraste, só uma custom property CSS
  muda (`--split-ratio`, mutação direta do DOM via ref, throttled por `requestAnimationFrame`) —
  zero chamadas a `patchAppSettings`/`save_file` por `mousemove`, decisão via sabatina. O commit
  (`setSplitRatio`, que persiste) acontece uma única vez, no `mouseup`. Um overlay full-screen
  (`.split-drag-overlay`) captura o mouse durante o drag para o CodeMirror não iniciar seleção de
  texto simultânea ao resize.
- Botão de toggle (`PreviewToggleButton.tsx`): canto fixo `bottom-left`, novo — decisão via
  sabatina, espelha o `.save-indicator` que já ocupa `bottom-right`, sem mexer em
  `ThemeToggle`/`HistoryPanel` existentes. Atalho `Cmd+Shift+P` (`useLayoutShortcuts.ts`, mesmo
  padrão de `useTabShortcuts.ts`) — sem conflito hoje; revisitar se `#24` (menu nativo) ou uma
  command palette usarem a mesma combinação no futuro.
- **Débito consciente**: o divisor (`role="separator" aria-orientation="vertical"`) não tem
  navegação por teclado (setas para ajustar largura) — fora do critério de aceite desta issue.

**Afeta:** qualquer issue futura que adicione uma terceira chave a `settings.json` já tem
`appSettings.ts` como o lugar certo para ler/escrever — não precisa reabrir essa discussão.

## #20 — Sincronização de rolagem entre editor e preview

- `EditorPane`/`PreviewPane` passaram a `forwardRef`, expondo uma API imperativa mínima
  (`EditorPaneHandle`/`PreviewPaneHandle`) em vez de `SplitLayout` acessar seus internals via
  wrapper-div+`querySelector` ou via uma store zustand nova — decisão via sabatina. `SplitLayout`
  é quem monta as refs e passa pro novo hook `src/layout/useScrollSync.ts`, mantendo a lógica de
  sync isolada da lógica de drag/`splitRatio` já existente ali.
- Blocos de topo do preview (`token.level === 0` — parágrafo, heading, blockquote, lista, tabela,
  fence, hr; exclui aninhados como `list_item_open`, nível 1) ganham `data-source-line` via uma
  regra `core` hand-rolled no pipeline `markdown-it` (`sourceLinePlugin`, `PreviewPane.tsx`), mesmo
  padrão de `extractFrontMatter` (#17) — sem plugin de terceiros. `DOMPurify.sanitize` preserva o
  atributo sem configuração extra (`ALLOW_DATA_ATTR` é `true` por padrão).
- **Achado de implementação**: markdown-it renderiza os atributos de um token `fence` no `<code>`,
  não no `<pre>` — ao trocar um bloco mermaid por `.mermaid-diagram`/`.mermaid-error`
  (`PreviewPane.tsx`), o `data-source-line` precisou ser copiado explicitamente do `<code>`
  original pro elemento substituto, senão a âncora se perdia depois da renderização assíncrona.
- Mapeamento por interpolação linear proporcional entre as âncoras vizinhas (`src/layout/scrollMapping.ts`,
  funções puras `lineToOffset`/`offsetToLine`, testadas isoladamente), recalculada **ao vivo** a
  cada evento de scroll a partir de `getBoundingClientRect()` — nunca cacheada entre renders. É
  isso que torna o sync tolerante a diagramas mermaid que mudam de altura de forma assíncrona sem
  nenhum tratamento especial: o próximo evento de scroll já vê a geometria atualizada. A lista de
  âncoras inclui duas sintéticas (início do documento e fim, usando `scrollHeight`/total de linhas)
  para que os extremos do documento interpolem corretamente, não só entre blocos marcados.
- Guard anti-loop: uma variável local (`syncing: "editor" | "preview" | null`) setada antes do
  scroll programático do painel alvo, checada no início do listener desse mesmo painel para
  ignorar o eco, liberada no próximo `requestAnimationFrame`.
- Geometria do lado do editor não precisou de interpolação própria — `EditorView.lineBlockAt`/
  `lineBlockAtHeight` (CodeMirror 6) já dão `top`/`height` exatos por linha, relativos ao topo do
  documento.
- Sem resync explícito ao trocar de aba ou dar toggle no preview — o mecanismo natural de eventos
  de scroll já cobre a troca de aba (via `scrollDOM.scrollTop = getScrollTop(tabId)`, #21); toggle
  do preview pode nascer levemente desalinhado até o próximo scroll do usuário, aceito
  conscientemente (fora do critério de aceite da issue).

### Bugfix pós-implementação: sync nunca funcionava (reportado pelo usuário logo após o PR)

Causa: `useScrollSync` roda num `useEffect` de `SplitLayout` cujo array de dependências original
era `[editorRef, previewRef, enabled]` — sem `tabId`. No boot real do app (`App.tsx`), `activeTabId`
começa `null` (o bootstrap do workspace/abas é assíncrono via `invoke`), e `SplitLayout` só monta
`EditorPane` quando `tabId` é truthy (`{tabId && <EditorPane ... />}`). No primeiro mount do efeito,
`editorRef.current` portanto ainda era `null`, e o early-return por handle ausente disparava — mas
como `editorRef`/`previewRef` são refs (identidade estável, não mudam) e `enabled` não muda sozinho,
o efeito nunca tinha motivo pra rodar de novo depois que a aba real aparecesse. Resultado: a
sincronização nunca chegava a se anexar em uso normal do app, só funcionaria por acaso num teste que
já montasse com `tabId` não-nulo desde o início (que é exatamente o que os testes originais, sem
cobertura de DOM/scroll, não pegaram). Fix: `tabId` entrou nas deps do efeito principal de
`useScrollSync` (assinatura ganhou um 5º parâmetro `tabId: string | null`), então o efeito roda de
novo assim que a primeira aba real monta e a handle do editor passa a existir. Novo
`src/layout/useScrollSync.test.ts` (usando `renderHook`, refs mockadas — sem depender de CodeMirror
real) cobre esse cenário como regressão, além de um teste de ida-e-volta simples (rolar o editor
rola o preview proporcionalmente) e do caso `enabled = false`. **Lição geral:** qualquer efeito que
lê `ref.current` de um componente irmão/filho condicionalmente montado precisa incluir na lista de
deps algum valor que mude no exato momento em que essa montagem acontece — a ref em si nunca
dispara um re-run sozinha.

### Bugfix pós-implementação #2: só preview→editor funcionava (reportado pelo usuário depois do fix acima)

O fix do `tabId` nas deps resolveu o boot (efeito passou a rodar depois que a aba real aparece), mas
expôs um problema mais profundo, sob `React.StrictMode` (que o app real usa em `main.tsx`, mas os
testes anteriores não): quando `EditorPane` monta pela primeira vez (transição `tabId: null →
"tab-1"`), o React duplica os efeitos de montagem **dela especificamente** (cria um `EditorView`
v1 → destrói (zerando `viewRef.current`, fix de `#21`) → cria v2) — esse é o comportamento padrão de
`StrictMode` para qualquer componente que está montando pela primeira vez, independente de quando no
tempo de vida do app isso acontece. O efeito de `useScrollSync` em `SplitLayout`, por outro lado,
**não** é uma montagem nova (`SplitLayout` já existia; é só uma re-execução por dependência
mudada) — então esse efeito específico **não** sofre o duplo-invoke. Capturar `editorHandle.getScrollDOM()`
uma única vez no corpo do efeito (abordagem original) corria o risco real de rodar entre a
destruição de v1 e a criação de v2 (ou logo após v1, antes da destruição) — grudando o listener num
`scrollDOM` morto/obsoleto, nunca o mesmo elemento que fica de fato na tela. `previewContainer`
não sofre disso: `PreviewPane` nunca destrói/recria seu container (só reescreve `innerHTML`), então
seu elemento tem identidade estável — por isso só a direção preview→editor funcionava. Confirmado
empiricamente: um teste que renderiza `SplitLayout` dentro de `<StrictMode>` de verdade e dispara um
evento `scroll` real no `.cm-scroller` (via `container.querySelector`, pegando o elemento que
realmente está no DOM) só passou a mover `previewPane.scrollTop` depois do fix abaixo — sem
`StrictMode`, o bug não se manifestava, o que explica por que os testes da primeira rodada (sem
`StrictMode`) não pegaram isso.

Fix (mais robusto que só ajustar deps de novo): `useScrollSync` passou a anexar um **único listener
delegado**, em fase de *capture*, no container estável de `SplitLayout` (`containerRef`, o
`.app-main`, que nunca é destruído) — `"scroll"` não faz bubbling, mas ainda passa pela fase de
captura ao descer até o alvo, então um listener `{capture: true}` num ancestral recebe o evento de
qualquer descendente. Dentro do handler, a handle do editor/preview e o elemento de scroll são
resolvidos **a cada evento** (`event.target` comparado contra `editorHandle.getScrollDOM()`/
`previewHandle.getContainer()` chamados ali mesmo, nunca cacheados fora do handler) — então o
listener nunca fica "grudado" num elemento específico, e sobrevive a qualquer remontagem futura do
editor sem precisar caçar a próxima dependência certa pra colocar no array de deps. Isso também
tornou o parâmetro `tabId` (do fix anterior) desnecessário — removido: a assinatura agora é
`useScrollSync(containerRef, editorRef, previewRef, source, enabled)`, e o efeito roda só uma vez
(gate único em `enabled`), sem precisar reagir a troca de aba. `useScrollSync.test.ts` foi reescrito
pra montar uma árvore DOM real (`root > editorScrollDOM, previewContainer`) e cobrir explicitamente
"o elemento de scroll do editor troca de identidade sem o efeito rodar de novo, e o próximo scroll
ainda funciona" — a regressão exata do bug.

**Lição geral:** um `useEffect` que lê `ref.current` de um filho **não pode assumir que a
identidade do elemento resolvido nesse momento é a mesma que vai ficar montada** quando esse filho
sofre uma montagem sujeita ao duplo-invoke do `StrictMode` (dev) — mesmo que o próprio efeito leitor
não seja, ele, uma montagem nova. Testes sem `<StrictMode>` explícito não pegam esse tipo de bug (só
o teste de `#21`/`EditorPane.test.tsx` que já envolvia `<StrictMode>` deliberadamente o teria
revelado; nenhum teste de `#20` fazia isso na primeira rodada). Delegação num ancestral estável,
resolvendo a handle/elemento **dentro** do handler em vez de capturá-los no setup do efeito,
elimina a classe inteira desse problema em vez de perseguir a próxima dependência certa.

### Bugfix pós-implementação #3: scroll do editor lento/borrado (reportado pelo usuário depois do fix #2)

Causa: `getPreviewAnchors` (`querySelectorAll` + um `getBoundingClientRect` por bloco marcado, que
força layout síncrono) rodava dentro do handler de `"scroll"` em todo evento bruto — scroll por
trackpad/inertial no WKWebView (Tauri no macOS) dispara isso numa frequência bem maior que 60fps,
travando a main thread e deixando o próprio scroll do editor com frames perdidos/texto
aparentemente borrado (motion blur por frame skipping, não é um problema de renderização do
CodeMirror em si). Fix: cada direção (editor→preview e preview→editor) agora é *throttled* a no
máximo uma execução do cálculo pesado por frame, via um guard booleano (`editorSyncScheduled`/
`previewSyncScheduled`) que só permite um `requestAnimationFrame` pendente por vez — eventos extras
durante a mesma rajada são descartados, não enfileirados. A posição (linha do editor/`scrollTop` do
preview) é relida **dentro** do callback do rAF, não capturada no momento do evento — então mesmo
throttled, o sync sempre usa a posição mais recente quando o frame efetivamente roda, sem perder
precisão por causa do throttle. Novo teste em `useScrollSync.test.ts` dispara uma rajada de 5
eventos "scroll" sintéticos antes de deixar qualquer frame rodar e confirma que o cálculo pesado
(`getTopVisibleLine`) só é chamado 1 vez, não 5.

**Lição geral:** qualquer handler de `"scroll"` que faça leitura de geometria (`getBoundingClientRect`,
`offsetTop`, etc.) — que força layout síncrono — precisa de throttle por frame; scroll nativo por
trackpad no WebKit dispara eventos numa taxa alta o bastante pra isso travar a main thread de forma
perceptível, mesmo que o trabalho em si pareça barato à primeira vista.

**Afeta:** `#24`/`#25` (menu nativo/explorador) podem reaproveitar o padrão de `forwardRef`+
`useImperativeHandle` se precisarem de acesso imperativo aos painéis. Qualquer issue futura que
mude a estrutura de blocos de topo do `markdown-it` (novo plugin, novo tipo de token) deve
verificar se `sourceLinePlugin` continua marcando os blocos esperados.

## #16 — Busca e substituição no documento

- **Bug latente encontrado**: `editorStateRegistry.ts` já importava e registrava `searchKeymap` de
  `@codemirror/search` desde antes desta issue (não dá pra saber desde quando), mas nunca incluía a
  extensão `search()` em si — sem ela não existe `StateField` de busca nem painel pra abrir, então
  Cmd+F não fazia nada. O trabalho real desta issue foi ligar a extensão que faltava, não
  reimplementar busca/substituição do zero.
- **Cmd+Option+F não abre um painel "com replace visível"**: confirmado lendo o código-fonte da
  versão instalada de `@codemirror/search` — o painel padrão (`SearchPanel`) sempre renderiza os
  campos de busca e substituição juntos, não existe um estado oculto/visível pro replace. Decisão
  via sabatina: Cmd+Option+F (`src/editor/searchExtensions.ts`, keymap customizado `Mod-Alt-f`)
  chama o mesmo `openSearchPanel` e só move o foco pro campo de replace — desvio consciente do
  texto literal da issue, que supunha um toggle que não existe nessa versão da lib.
- `search({ top: true })` (painel no topo do editor, conforme a issue) + o keymap customizado vivem
  em `src/editor/searchExtensions.ts`, novo módulo dedicado — mesmo padrão de `slashMenu.ts`/
  `markdownCommands.ts` (uma extensão CodeMirror auto-contida por concern, não tudo dentro de
  `editorStateRegistry.ts`).
- Estilização do painel (`src/editor/editorTheme.ts`): `.cm-panel.cm-search`, `.cm-textfield`,
  `.cm-button`, `.cm-searchMatch`/`.cm-searchMatch-selected` com tokens de `tokens.css` — dois
  tokens novos (`--color-search-match-bg`, `--color-search-match-selected-bg`), já que não havia
  nenhum token semântico pra highlight de ocorrências. `@codemirror/search` já injeta cores default
  pra essas classes via `baseTheme` (menor precedência), então um `EditorView.theme()` normal
  sobrescreve sem precisar de `!important` nem seletor mais específico.
- **Achado de teste**: o resto do comportamento (Enter/Shift-Enter navegam, Esc fecha e devolve o
  foco, replace/replace all) já vem de graça do `searchKeymap`/`SearchPanel` da lib — não foi
  reimplementado, só coberto por teste. Highlight de ocorrências (`.cm-searchMatch`) só aparece com
  o painel **aberto** (`searchHighlighter` do CM6 checa `panel` no `searchState` antes de decorar) —
  testes que só chamam `setSearchQuery` sem abrir o painel primeiro (via `openSearchPanel`) não vêem
  nenhum highlight, mesmo com a query válida.
- **Achado de ambiente de teste**: `navigator.platform` no jsdom do Vitest deste projeto vem vazio
  (não bate com `/Mac/`), então a detecção de plataforma do CodeMirror trata bindings `Mod-*` como
  `Ctrl-*` nesse ambiente, não `Meta-*` — mesmo rodando em uma máquina macOS real. Testes que
  simulam `KeyboardEvent` reais pra exercitar keymap (`src/editor/searchExtensions.test.ts`) usam
  `ctrlKey: true` em vez de `metaKey: true` por causa disso, com comentário explicando; verificação
  manual via `mise run dev` é quem confirma que Cmd (não Ctrl) funciona no app real.

**Afeta:** `#24` (menu nativo) volta a estar desbloqueada — o item "Buscar" do menu Editar pode
disparar o mesmo `openSearchPanel`/atalho já expostos aqui.

## #24 — Menu nativo do macOS e atalhos de teclado

- **"Abrir pasta" (Cmd+O) é, na prática, abrir arquivo**: o texto da issue fala em "Abrir pasta",
  mas não existe conceito de trocar workspace no app (`#21` já tinha antecipado isso: "Cmd+O
  nativo, #24" é um dos dois gatilhos previstos pra `openTab(path)`, junto do clique no explorador
  de `#25`). Implementado com `tauri-plugin-dialog` (nova dependência Rust+JS): seletor nativo
  filtrado por `.md`, `defaultPath` no workspace root, resultado passado direto pra
  `tabsStore.openTab`. Permissão `dialog:default` adicionada a `capabilities/default.json`.
- **"Novo" usa Cmd+T, não Cmd+N** (sugestão literal do texto da issue) — Cmd+T já era o atalho
  implementado pra nova aba desde `#21`; a própria issue exige que o menu não duplique lógica, então
  o accelerator seguiu o que já existia, não o texto.
- **Exportar HTML/PDF ficou fora do menu Arquivo nesta issue** — `#26`/`#27` não existem ainda.
  Quando `#26` for implementada, ela é quem registra o item (mesmo padrão de `#16` desbloqueando
  `#24`).
- **Tema no menu Visualizar** (submenu Sistema/Claro/Escuro) são 3 `MenuItem` planos disparando
  `themeStore.setPreference`, **sem** checkmark nativo sincronizado com a preferência atual —
  evitaria sincronização bidirecional JS↔Rust só pra refletir estado que o `ThemeToggle.tsx`
  já mostra dentro do app.
- **Achado técnico (molda boa parte da implementação)**: no macOS, um `NSMenuItem` com accelerator
  intercepta o evento de teclado *antes* de chegar à `WKWebView` — a barra de menu nativa do
  sistema recebe o `performKeyEquivalent` primeiro. Assim que os itens nativos existem com os
  mesmos atalhos, os listeners JS equivalentes nunca mais são alcançados: removidos os branches
  `t`/`w` de `src/tabs/useTabShortcuts.ts` (Cmd+T/Cmd+W viram exclusividade do menu; `Shift+]`/`[`
  e `1-9` continuam JS, sem equivalente no menu) e apagado `src/layout/useLayoutShortcuts.ts`
  inteiro (Cmd+Shift+P também vira exclusividade do menu). Cmd+F sofre o mesmo efeito: o item
  "Buscar" do menu passa a ser o único caminho pra *abrir* o painel — o `searchKeymap` do CodeMirror
  continua registrado e funcional pra Enter/Shift-Enter/Esc **dentro** do painel já aberto. Cmd+Option+F
  (`Mod-Alt-f`, foco no campo replace, `#16`) não tem item de menu equivalente e não foi afetado.
- **Sair (Cmd+Q)**: item customizado (id `"quit"`, **não** `PredefinedMenuItem::quit()`) cujo
  handler em `src-tauri/src/app_menu.rs`/`lib.rs` chama `window.close()` em vez de `app.exit()`
  direto — no Tauri 2, `WebviewWindow::close` dispara o mesmo `WindowEvent::CloseRequested` já
  tratado desde `#7` (`prevent_close` + `emit("app-close-requested")` → frontend `flushAll()` →
  `invoke("quit_app")`), reaproveitando o handshake de flush existente sem nenhum código novo de
  IPC. `PredefinedMenuItem::quit()` pularia esse handshake e arriscaria perder até os 800ms de
  debounce do autosave.
- **Renomear**: `editingTabId` (só o id, não o rascunho de texto) subiu de estado local de
  `TabBar.tsx` pra `tabsStore` (`startRenaming`/`cancelRenaming`/`commitRenaming`) — o item de menu
  precisa disparar a mesma UI de edição inline de fora da árvore React. O campo de texto em si
  (`src/tabs/TabBar.tsx`) virou **não-controlado** (`defaultValue`, sem `useState` de rascunho): um
  `useEffect` setando `useState` a partir de `editingTabId` disparava o lint
  `react-hooks/set-state-in-effect` (cascading render); como o input já monta uma instância nova
  toda vez que aparece (alternância span/input no JSX), `defaultValue={tab.title}` resolve sem
  efeito nenhum.
- Estrutura do menu (`src-tauri/src/app_menu.rs`, `MenuBuilder`/`SubmenuBuilder`): submenu "scrible"
  **primeiro** na lista — vira automaticamente o app menu do macOS (não precisa de nenhuma chamada
  extra) — com só o item Sair; Arquivo (Novo/Abrir arquivo/Fechar aba/Renomear); Editar
  (Undo/Redo/Cut/Copy/Paste nativos do `PredefinedMenuItem`, sem wiring — CodeMirror 6 já trata os
  eventos `beforeinput` de `historyUndo`/`historyRedo` que o SO dispara via esses itens — + Buscar);
  Visualizar (Alternar preview + submenu Tema); Janela (`minimize`/`maximize`, "zoom" no macOS).
  Dispatch central em `app.on_menu_event`: `"quit"` tratado 100% em Rust, os demais ids customizados
  viram `app.emit("menu", id)`, consumido por um único listener em `App.tsx` que roteia pros stores
  (`tabsStore`/`layoutStore`/`themeStore`) ou pro novo `SplitLayoutHandle.openSearch()`
  (`forwardRef`+`useImperativeHandle`, mesmo padrão reaproveitado de `#20`).
- Sem teste automatizado para `app_menu.rs`/o wiring do evento `"menu"` em `App.tsx` — mesma postura
  já registrada para `#22`/`#23` (integração nativa/visual sem precedente de teste no repo);
  verificação real ficou manual via `mise run dev`.

**Afeta:** `#25` (explorador) ganha um segundo gatilho de referência pro padrão de disparar
`tabsStore.openTab` fora de clique direto na `TabBar`. `#26`/`#27` (export), quando implementadas,
devem registrar seus próprios itens em `app_menu.rs` (submenu Arquivo) em vez de reabrir essa
decisão.

## #25 — Explorador de arquivos lateral

- **`list_dir` (flat, `#6`) permanece intocado** — só usado hoje por `tabsStore.newTab` pra checar
  colisão de nome. Novo command dedicado `list_dir_entries(path) -> Vec<DirEntry{name, isDir}>`
  (camelCase via `#[serde(rename_all = "camelCase")]`, primeiro uso desse atributo no projeto)
  alimenta o explorador, buscado **lazy por pasta expandida** — não uma árvore recursiva completa
  numa chamada. Filtra dotfiles/dotdirs (esconde `.scrible/` de graça, sem checagem de nome
  hardcoded) e arquivos sem extensão `.md`; ordena pastas antes de arquivos, depois alfabético
  case-insensitive — tudo no Rust, o frontend só renderiza o que recebe.
- **Novo `create_dir`/`delete_dir`** em `fs_ops.rs`, mesmo padrão single-purpose de `rename_file`/
  `delete_file`. `rename_file` (já genérico via `fs::rename`) não precisou mudar — funciona pra
  pastas também.
- **Novo `tree_watcher.rs`, watcher recursivo dedicado e separado de `watcher.rs`**: observa a raiz
  do workspace inteira (`RecursiveMode::Recursive`), emitindo `"workspace-tree-changed"` sem
  payload — o frontend decide o que re-buscar (raiz + pastas com `expandedDirs`). Não reaproveita
  `watcher::wait_for_settled_event` (drena o canal sem preservar path dos eventos, incompatível com
  o filtro que o explorador precisa) — novo `wait_for_settled_relevant_event` local, que também
  ignora rajadas inteiras dentro de `.scrible/` (evita refresh espúrio a cada autosave de
  `settings.json`/snapshot de histórico). Sem supressão de eco por mtime (diferente do watcher de
  `#7`/`#10`): aqui um refresh redundante da árvore após a própria escrita do scrible é inofensivo,
  não haveria risco de banner de conflito indevido.
- **`tabsStore.newTab` generalizado** para aceitar diretório alvo opcional (default
  `workspaceRoot`) — o explorador cria arquivos em qualquer pasta clicada reaproveitando o mesmo
  padrão `untitled-N.md`, sem lógica duplicada.
- **Novo `tabsStore.syncPathsAfterRename(oldPath, newPath)`**: corrige o `path` de qualquer aba
  cujo path seja exatamente `oldPath` (arquivo renomeado) ou comece com `oldPath + "/"` (aba
  dentro de uma pasta renomeada) — prefix match, sem chamar `rename_file` de novo (só sincroniza
  estado já refletido em disco pelo `explorerStore.renameEntry`).
- **`closeTab` ganha `opts?: { skipFlush?: boolean }`**: excluir o arquivo de uma aba aberta via
  explorador fecha a aba sem tentar salvar antes — salvar recriaria o arquivo que acabou de ser
  apagado. `explorerStore.deleteEntry` fecha todas as abas afetadas (path exato ou prefixo, mesmo
  critério do rename) com `skipFlush: true` antes de chamar `delete_file`/`delete_dir`.
- **Menu de contexto é um dropdown HTML customizado** (`ExplorerContextMenu.tsx`), não nativo —
  mesmo idioma de fechar já usado em `HistoryPanel`/`ThemeToggle` (`mousedown` fora + `Escape`).
  Primeiro precedente de menu de contexto (clique direito) no projeto; itens "Renomear"/"Excluir"
  só aparecem quando o clique foi num item real da árvore (não em área vazia).
- **Confirmação de exclusão via `tauri-plugin-dialog` `ask()`** (dependência já existente desde
  `#24`) — sem modal customizado novo.
- **Layout**: `app-shell` virou `flex-direction: row` com o explorador como primeiro item; o
  conteúdo antigo (TabBar + SplitLayout + chrome flutuante) foi envolvido em `.app-shell-content`
  (`position: relative`). **Achado**: os 4 botões flutuantes existentes (tema, histórico, preview,
  indicador de salvamento) e o `ConflictBanner` eram `position: fixed` relativos ao viewport
  inteiro — com o explorador ocupando a borda esquerda, `ThemeToggle`/`PreviewToggleButton`
  ficariam sobrepostos por ele. Todos os cinco viraram `position: absolute` dentro de
  `.app-shell-content`, sem mudar nenhum valor de `top`/`left`/`right`/`bottom` — o novo containing
  block já resolve o deslocamento sem cálculo extra.
- **Toggle do explorador**: aba fina fixa na borda esquerda (`ExplorerToggleTab.tsx`, `position:
  fixed`, independente do layout flex) — os 4 cantos já estavam ocupados, sem espaço pra mais um
  botão flutuante. Atalho `Cmd+Shift+E` é **só o item nativo do menu** (`app_menu.rs`, submenu
  Visualizar) — sem `useExplorerShortcuts.ts`/listener JS paralelo: o achado já registrado em
  `#24` (accelerator nativo intercepta o evento antes da `WKWebView`) tornaria um listener JS pro
  mesmo atalho morto por definição.
- **Redimensionamento da largura**: handle simples e independente (mousedown/mousemove/mouseup,
  mutação direta de `--explorer-width` throttled por `requestAnimationFrame`, commit só no
  mouseup) — não reaproveita `SplitLayout`, que é específico do ratio de 2 painéis. Persistido em
  `appSettings.ts` (`explorer: { visible, width }`), mesmo padrão de merge dedicado de `layout`.
- **Estado expandido/colapsado das pastas não é persistido** — vive só em `explorerStore`
  (zustand), reseta a cada boot. Cache de listagens por pasta (`entriesByDir`) também é só em
  memória, migrado por prefixo em rename e limpo por prefixo em delete de uma pasta.
- Sem teste automatizado pro posicionamento visual do menu de contexto (mesma postura de
  `#22`/`#23`/`#24`); toda a lógica pura (fs_ops novo, watcher novo, stores, prefix-matching de
  rename/delete) tem cobertura automatizada.

**Afeta:** `#26`/`#27` (export) devem registrar seus próprios itens em `app_menu.rs` sem reabrir a
decisão de `#24`. Qualquer issue futura que precise de outro botão flutuante deve usar
`.app-shell-content` como containing block (não o viewport) — os 4 cantos já estão ocupados.

## #26 — Exportar para HTML standalone

- **Pipeline de markdown extraído para `src/preview/markdownPipeline.ts`** (nova): a instância `md`
  (`MarkdownIt` + `footnote` + `taskLists` + `sourceLinePlugin`), `extractFrontMatter`,
  `renderFrontMatterTable`, `escapeHtml` saíram de dentro de `PreviewPane.tsx` sem nenhuma mudança
  de comportamento — é o que a própria issue pede ("reaproveitar o pipeline do preview como fonte
  da verdade"); sem esse split, o export duplicaria a definição do `md`. `PreviewPane.tsx` continua
  dono do `useMemo`/debounce/efeito de mermaid, só importa as funções puras de lá agora.
- **CSS de conteúdo extraído para `src/preview/PreviewPane.css`** (nova, movida de `App.css`):
  `.preview-pane`, `.mermaid-diagram`/`.mermaid-error`, tabelas e `.front-matter*`. O export importa
  o mesmo arquivo como texto cru via `?raw` do Vite, embutindo o CSS real no HTML gerado em vez de
  duplicar as regras — qualquer ajuste futuro de estilo do preview propaga automaticamente pro
  export.
  **Achado de implementação:** por padrão o Vitest troca **todo** import de `.css` (inclusive com
  `?raw`/`?inline`) por um módulo vazio, mesmo fora de qualquer mock explícito — é uma otimização
  de performance do runner, não um bug do Vite. Sem `test: { css: true }` em `vite.config.ts`, os
  testes do export liam string vazia de `tokens.css`/`PreviewPane.css` e passavam silenciosamente
  (nenhum teste comparava o HTML final contra um token real o bastante pra pegar isso sem inspeção
  manual do output). Fix: `css: true` ligado globalmente pro projeto de teste — sem escopo por
  arquivo, já que qualquer suíte futura que precise de conteúdo real de CSS (não só `#26`) bateria
  no mesmo problema.
- **Tema do export é congelado no valor resolvido na tela no momento do clique** (decisão via
  sabatina) — sem diálogo adicional de escolher claro/escuro, ao contrário do que o texto original
  da issue sugeria como opção. Motivo: o SVG do mermaid já é renderizado com paleta fixa
  (`theme: "dark"|"default"`) no momento do `mermaid.render`, então só congelar no tema atual
  garante fidelidade exata ao preview — uma escolha independente no diálogo poderia produzir um
  HTML com CSS de um tema e mermaid de outro.
- `renderStaticBodyHtml` (`src/export/exportHtml.ts`) replica o efeito de mermaid de
  `PreviewPane.tsx` mas como função assíncrona pura sobre um `<div>` **desanexado** (nunca inserido
  no DOM visível — `mermaid.render()` não depende disso, gerencia seu próprio elemento temporário
  internamente) rodando sobre o conteúdo **vivo** da aba (`documentStore`), não o `debouncedSource`
  do preview (debounce é otimização de digitação, irrelevante pra um export único). Diferença
  deliberada do efeito ao vivo: resolve todos os blocos mermaid com `await Promise.all(...)` (não o
  `forEach(async ...)` fire-and-forget), porque o export precisa que todo `mermaid.render` termine
  antes de ler `container.innerHTML` de volta.
- **Novo command Rust `write_export_file`** (`fs_ops.rs`/`lib.rs`), deliberadamente **não**
  reaproveitando `save_file`: esse grava `LastSaveMtime` global (usado pelo watcher do path fixo
  `untitled.md`, #10) e sempre dispara `history::maybe_snapshot` — efeitos colaterais do fluxo de
  autosave do workspace, sem sentido (e ruidosos — criaria diretório de histórico) pra um path de
  export arbitrário fora do workspace. `write_export_file` é só `fs::write` + `FsError::from_io`,
  sem escrita atômica via temp+rename (não compete com nenhum autosave/watcher no mesmo path).
- Menu: novo item `export_html` em `file_menu` (`app_menu.rs`), sem nenhuma mudança em
  `lib.rs::on_menu_event` — cai no `app.emit("menu", id)` genérico já existente; `App.tsx` só ganhou
  mais um `case` no switch.
- Diálogo de salvar via `save()` de `@tauri-apps/plugin-dialog` — primeiro uso desse método no
  repo (só `open`/`ask` existiam antes, de `#21`/`#25`); capability `dialog:default` já cobria.

**Afeta:** `#27` (exportar PDF) deve reaproveitar `renderStaticBodyHtml`/`buildStandaloneHtml` como
fonte de HTML de entrada em vez de reimplementar o pipeline, e herda a mesma decisão de congelar no
tema resolvido no momento do export.

## #27 — Exportar para PDF

- **Abordagem original da sabatina (iframe oculto + `window.print()`) não funciona**: verificação
  manual mostrou que clicar "Exportar para PDF" não fazia nada. Causa raiz confirmada por pesquisa:
  o WKWebView usado pelo Tauri/wry no macOS não implementa `window.print()` — não há
  `WKUIDelegate` de impressão instalado, limitação conhecida e documentada upstream
  (github.com/tauri-apps/wry#707, "Add ability to print webview to pdf silently"). Chamar
  `print()* de dentro de qualquer WKWebView do Tauri (hidden ou não) é um no-op silencioso.
- **Solução adotada: `WKWebView.createPDF()` nativo** (macOS 11+, a mesma API por trás de "Exportar
  como PDF" no Safari), via bindings `objc2`/`objc2-web-kit`/`block2` — primeiras dependências
  Rust específicas de macOS do projeto (`[target.'cfg(target_os = "macos")'.dependencies]` em
  `Cargo.toml`; `src-tauri/src/pdf_export.rs` inteiro sob `#[cfg(target_os = "macos")]`, comando
  `export_pdf` idem, tanto na definição quanto no registro em `generate_handler!`). Evita depender
  do painel de impressão do SO e evita duplicar o pipeline de renderização de markdown/mermaid em
  outro motor (ex: `tauri-plugin-printer-wkhtml-bin`, que embala um binário `wkhtmltopdf`
  separado — descartado por isso).
- **Janela oculta dedicada**: `render_html_to_pdf` cria uma `WebviewWindow` nova (`visible(false)`,
  label `pdf-export-<contador atômico>`) só para o export, carrega o HTML via
  `WKWebView.loadHTMLString_baseURL` (acessando o WKWebView real através de
  `window.with_webview` + `webview.inner().cast()`, padrão documentado pelo próprio Tauri) — não
  compete com a aba que o usuário está editando. Destruída com **`.destroy()`, não `.close()`**:
  `.close()` emite `WindowEvent::CloseRequested`, que o handler global em `lib.rs` intercepta com
  `prevent_close()` (pensado para o handshake de flush do autosave da janela principal) — nunca
  chegaria a destruir essa janela temporária.
- **Achado crítico de threading, encontrado só na verificação manual** (não em teste automatizado —
  exige o WKWebView real): os comandos deste app executam na **mesma thread do loop de eventos
  nativo** (main thread) — `with_webview` despacha inline nela quando já está nela
  (`tauri-runtime-wry`: `send_user_message` roda o handler direto se `current_thread_id ==
  main_thread_id`, ou enfileira via proxy caso contrário). O completion handler do `createPDF` é
  entregue pelo WebKit através da fila principal (GCD/`dispatch_async` na main queue), que só drena
  quando o loop de eventos nativo consegue rodar de novo. A primeira implementação usava
  `std::sync::mpsc::recv_timeout`/`std::thread::sleep` (bloqueio síncrono) nessa mesma thread —
  travava o loop de eventos por completo, **inclusive impedindo o próprio callback do createPDF de
  ser entregue**: confirmado via `eprintln!` que o callback só chegava a rodar *depois* do timeout
  de 30s, exatamente quando a função finalmente devolvia o controle. Sintoma no app: clicar
  "Exportar para PDF" travava o app inteiro, exigindo forçar encerramento. Fix: comando `export_pdf`
  virou `async fn`, `render_html_to_pdf` usa `tokio::time::sleep(...).await` e
  `tokio::sync::oneshot` + `tokio::time::timeout(...).await` no lugar dos equivalentes síncronos —
  `.await` cede o controle de volta pro loop de eventos nativo nos pontos de espera, permitindo o
  callback do WebKit ser entregue normalmente. `tokio` entrou como dependência direta (features
  `sync`, `time`) só para essas duas primitivas — o resto do projeto usa `tauri::async_runtime`
  transitivamente sem precisar disso.
- **Tema sempre claro no PDF** (`renderStaticBodyHtml`/`buildStandaloneHtml` chamados com `"light"`
  fixo), independente do tema atual da UI — critério de aceite literal da issue ("para economizar
  tinta/leitura impressa"), desviando conscientemente da decisão de `#26` de congelar no tema
  resolvido da tela. Decidido via sabatina.
- **CSS de impressão dedicado** (`src/export/print.css`, importado via `?raw` mesmo padrão de
  `tokens.css`/`PreviewPane.css`): `@page { margin: 2cm }`, `break-inside: avoid` em blocos de
  código/mermaid/tabela/citação, `print-color-adjust: exact` (preserva cores de preenchimento do
  mermaid, que navegadores por padrão suprimem em impressão). `buildStandaloneHtml` ganhou um
  parâmetro `extraCss` opcional (default `""`) para injetar isso só no fluxo de PDF, sem afetar o
  export de HTML (`#26`).
- **Diálogo de salvar**: mesmo padrão de `#26` (`save()` do `tauri-plugin-dialog`, filtro `.pdf`,
  `defaultPath` derivado do path da aba) — o comando `export_pdf` recebe `html` + `path` e faz
  `fs::write` direto (sem escrita atômica, mesma decisão de `write_export_file` em `#26`: não
  compete com autosave/watcher em paths de export).
- **Sem teste automatizado para a geração real do PDF** (o `WKWebView.createPDF()` em si não é
  exercitável em jsdom/vitest nem em `cargo test`) — mesma postura já registrada em
  `#12`/`#22`/`#23`/`#24` para integrações nativas sem precedente de teste no repo. Testes cobrem só
  o que é puro/determinístico do lado JS: `buildStandaloneHtml` com `extraCss`, diálogo de salvar
  (abre/cancela), tema sempre claro no payload do comando.

**Afeta:** qualquer issue futura que precise chamar outra API do WKWebView a partir do Rust
(`objc2-web-kit`) tem aqui o padrão de acesso (`with_webview` + `webview.inner().cast()`) e o
alerta de threading (nunca bloquear sincronamente dentro de um comando — usar `.await`). `#32`
(builds Windows/Linux) precisa decidir uma alternativa não-macOS para `export_pdf` — hoje ele só
existe sob `#[cfg(target_os = "macos")]`, então o item de menu "Exportar para PDF…" existiria sem
handler funcional em outras plataformas se `app_menu.rs` não for revisitado junto.
