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

## #60 — Toolbar e status bar

- **Diagnóstico**: o chrome da UI vivia em 5 elementos `position: absolute`/`fixed` nos 4 cantos +
  borda esquerda de `.app-shell-content` (tema, histórico, preview, `.save-indicator`, aba `▸` do
  explorador), cobrindo texto do editor/preview e sem espaço para crescer — a própria `#25` já
  registrava isso em `Afeta:`. Consolidados numa barra única no topo (abas + toolbar) e uma status
  bar no rodapé, decisão via sabatina.
- **`lucide-react` como exceção justificada** à postura "sem dependência nova para escopo pequeno"
  (manual debounce/throttle/FNV-1a/DnD nativo de issues anteriores): 6+ ícones de traço consistente
  a 16px não é escopo pequeno o bastante pra valer a pena escrever à mão, e a lib faz tree-shaking
  natural do que é importado (só os ícones usados entram no bundle via ESM).
- **Novo `src/commands/registry.ts`**: fonte única de verdade das ações do app (`AppCommand { id,
  label, shortcut?, run, isActive? }`), substituindo o `switch` de 36 linhas que existia no listener
  do evento nativo `"menu"` em `App.tsx` desde `#24`. O listener virou uma linha
  (`runCommand(event.payload)`); a Toolbar consome os mesmos comandos pelos mesmos ids. `id`
  desconhecido é no-op silencioso — mesma tolerância que o `switch` anterior tinha pra ids fora do
  `case`. Ponte imperativa (`EditorBridge`/`setEditorBridge`) cobre a única ação que só existe
  dentro da árvore React (`SplitLayoutHandle.openSearch()`); `App.tsx` a instala num `useEffect` e
  **anula no cleanup**, mesma regra já registrada na `#21` para efeitos que criam/destroem recurso
  imperativo fora do React.
- **Achado que molda a issue B (paleta de comandos)**: `⌘K` já é `insertLink`
  (`markdownCommands.ts:238`, `#13`) — não está livre pra virar o atalho da paleta. Combinado com o
  achado da `#24` (no macOS um `NSMenuItem` com accelerator intercepta a tecla **antes** da
  WKWebView), registrar a paleta em `⌘K` mataria o atalho de link do editor. A issue B usa `⌘P`.
- **Extração mínima, sem design system completo** (decisão via sabatina, rejeitando componentes
  `Button`/`Popover`/`Modal`): novo `src/ui/useClickOutside.ts` substitui 3 cópias manuais do "fecha
  ao clicar fora" (`ThemeToggle.tsx`, `HistoryPanel.tsx`, `ExplorerContextMenu.tsx` — esta última já
  tratava `Escape`, as outras duas não; o hook consolida o superset das três). Classes `.icon-button`
  e `.popover-surface` em `App.css` substituem os 3 blocos CSS byte-idênticos
  (`.theme-toggle`/`.history-toggle`/`.preview-toggle`) e as 3 superfícies de popover quase-idênticas
  (`.theme-menu`/`.history-panel`/`.explorer-context-menu`). `.popover-menu-item` é uma classe própria
  (não o seletor genérico `button`) para não vazar estilo pro botão "Restaurar" de
  `.history-item`, que convive no mesmo popover.
- **Tema: ícone reflete a preferência, não botão de ciclo** — preserva o espírito da `#23` ("mostra
  o estado atual sem exigir interação") com um quarto da largura: o ícone muda (`Monitor`/`Sun`/
  `Moon`) e o clique abre o mesmo dropdown de 3 opções de sempre.
- **Exportar: um ícone só com dropdown HTML/PDF**, não dois — `export_pdf` é `macos`-only (`#27`),
  um segundo ícone ficaria morto no Windows/Linux (`#32`).
- **Tooltip CSS próprio** (`[data-tooltip]::after`, `App.css`), não o `title` nativo — o delay do
  WKWebView (~1,5s) o torna inútil como ferramenta de descoberta de atalho, que era o problema que
  motivou a issue (atalhos só apareciam abrindo o menu nativo).
- **`ExplorerToggleTab.tsx` removido** — reverte conscientemente a decisão da `#25` (a aba `▸` só
  existia "porque os 4 cantos já têm botões flutuantes, sem espaço livre pra mais um"; a própria
  entrada previa essa reversão). O ícone de explorador na toolbar cobre 100% da função, com
  `aria-pressed` e tooltip mostrando `⇧⌘E`.
- **Status bar**: tri-estado de salvamento (`Salvando…`/`Não salvo`/`Salvo`, derivado de
  `DocumentEntry.status`/`.dirty` já existentes — nenhuma lógica nova) + contagem de palavras e
  caracteres (`useMemo` puro sobre `activeDoc.content`). Ficaram fora, por decisão da sabatina:
  linha/coluna do cursor (exigiria um `updateListener` novo do CodeMirror publicando a seleção pra
  fora) e caminho relativo do arquivo.
- **Indicador de não-salvo na aba**: `TabBar.tsx` ganhou um subcomponente `TabItem` que assina
  `dirty` por aba individualmente (mesma técnica de assinatura por item que `ExplorerNode` já usa em
  `ExplorerPanel.tsx`, `#25`) — evita re-render da barra inteira ao digitar. O ponto e o `×` ficam
  os dois no DOM o tempo todo (`.tab-close[data-dirty]` + CSS `display:none` alternado por estado/
  `:hover`), não um swap condicional via React — troca de estado não remonta o botão nem perde
  `:hover`.
- **Largura de leitura no preview** (`--reading-width: 70ch`, aplicada aos *filhos* de
  `.preview-pane`, não ao container — que é ao mesmo tempo o alvo de scroll e do `innerHTML`
  reescrito pelo efeito do mermaid, `#18`/`#23`). `display: grid` no container foi cogitado e
  descartado: grid items não fazem margin-collapse entre si, dobraria o espaçamento vertical entre
  parágrafos. Efeito colateral aceito: como `PreviewPane.css` é inlinada via `?raw` no export
  (`#26`/`#27`), a largura de leitura passa a valer também no HTML e no PDF exportados.
  **Correção posterior:** como `ch` resolve contra a fonte de cada elemento, `max-width: 70ch` dava
  larguras diferentes por tipo de bloco (h1/h2/h3 maiores que o painel, colados à esquerda; `pre` e
  tabelas mais estreitos que o texto). O token passou a `calc(var(--font-size-base) * 38)` (≈70
  caracteres, em px, igual para todo bloco). `@property` foi cogitado (resolver `70ch` uma vez no
  `.preview-pane`) e descartado: só existe no WebKit a partir do Safari 16.4, e o app ainda suporta
  macOS mais antigo — lá o bug voltaria. Qualquer largura nova pensada para valer para todos os
  blocos do preview não deve usar `ch`/`em`. `pre`, `blockquote` e `.mermaid-error` passaram a
  `box-sizing: border-box` para a caixa alinhar com as bordas do texto.
- **`ConflictBanner` saiu de `position: absolute` para o fluxo normal** — antes cobria as primeiras
  linhas do editor/preview quando aparecia; agora empurra o conteúdo.
- Testes: `ThemeToggle.test.tsx`/`HistoryPanel.test.tsx` (pré-existentes) passaram a consultar por
  `getByRole("button", { name: … })`/`aria-label` em vez de texto visível, já que os gatilhos viraram
  ícone-only. `PreviewToggleButton.test.tsx` foi apagado junto com o componente; a cobertura migrou
  pra `Toolbar.test.tsx` + `registry.test.ts`. Novos: `registry.test.ts`, `useClickOutside.test.ts`,
  `Toolbar.test.tsx`, `StatusBar.test.tsx`.

**Afeta:** `#29` (tela de preferências — ainda não existe; seria o lar natural do tema, da largura
de leitura e do intervalo de autosave, hoje espalhados). `#32` (builds Windows/Linux) ganha metade
do caminho pronto: a toolbar/registro de comandos é a "barra de comandos própria" que a issue já
previa como alternativa ao menu de sistema ausente fora do macOS. Issue B (paleta de comandos `⌘P`
+ modo foco, a abrir) consome `src/commands/registry.ts` sem retrabalho.

## #63 — Release de .dmg para macOS

- **Retomada da `#4`**: `.github/workflows/release.yml` já existia (disparo em tag `v*.*.*`, build +
  publicação via `softprops/action-gh-release`), mas nunca tinha sido exercitado — sem tags nem
  releases no repositório até aqui. Corrigidos os problemas que só apareceriam na primeira execução
  real: faltava `permissions: contents: write` (o `GITHUB_TOKEN` de um workflow disparado por tag não
  tem permissão de escrita por padrão nesse repo) e o padrão de tag virou `v*` (aceita sufixo de
  pre-release, ex. `v0.1.0-rc.1`).
- **Apenas Apple Silicon (arm64)**, decisão via sabatina — mantém `runs-on: macos-latest` (que já é
  arm64) e o path de bundle padrão do Tauri (`target/release/bundle/dmg/`). Build universal ficaria
  em `target/universal-apple-darwin/release/bundle/`, mudando o path do workflow, e dobraria o tempo
  de build (compila o Rust duas vezes) — adiado para quando `#32` trouxer a matriz de plataformas.
- **`package.json` como fonte única de versão**: `tauri.conf.json` passou de `"version": "0.1.0"`
  para `"version": "../package.json"` — suportado nativamente pelo Tauri v2 (o campo aceita um
  caminho para um JSON com `version`, resolvido a partir do CWD do CLI, que é `src-tauri/`). Antes,
  a versão estava triplicada (`package.json`, `tauri.conf.json`, `Cargo.toml`) sem nada garantindo
  que a tag da release correspondesse ao que ia dentro do bundle. `Cargo.toml` mantém um `version`
  próprio só por convenção do Cargo — não influencia mais o `CFBundleShortVersionString` do app.
- **Assinatura ad-hoc** (`bundle.macOS.signingIdentity: "-"` em `tauri.conf.json`) — não exige conta
  de desenvolvedor Apple. Sem selo nenhum, o Gatekeeper tende a mostrar "o app está danificado e
  deve ser movido para o Lixo" (exige `xattr -cr` no terminal pra contornar); com ad-hoc, mostra o
  aviso recuperável de "desenvolvedor não verificado" (Ajustes do Sistema → Privacidade e Segurança
  → Abrir Mesmo Assim). Assinatura com identidade real + notarização ficam para a `#28`.
- **Checksum publicado**: o job gera `SHA256SUMS.txt` (`shasum -a 256 *.dmg`) e publica junto do
  `.dmg` — único jeito de alguém verificar a integridade de um binário que ninguém assina.
- **`prerelease` automático por convenção de tag** (`contains(github.ref_name, '-')`): uma tag com
  sufixo (`v0.1.0-rc.1`) marca a release como pre-release no GitHub, sem ocupar o rótulo "latest";
  `vX.Y.Z` sem sufixo é release de verdade. Primeira tag publicada foi `v0.1.0-rc.1`, pra exercitar o
  pipeline antes da `v0.1.0` (que aguarda a `#9` fechar).
- **Gate do workflow é só tag × versão** (`scripts/check-version.sh`, chamado tanto pelo workflow
  quanto localmente) — não repete lint/typecheck/test porque a tag sempre parte de um commit da
  `main`, que já passou pelo CI completo em `ci.yml`. Falha em segundos se a tag não bater com
  `package.json`, antes de gastar o build.
- **Bump de versão nunca commita direto na `main`** (regra global do `CLAUDE.md`): `scripts/
  prepare-release.sh` (task `mise run release <versão>`) cria a branch `chore/release-vX.Y.Z`, roda
  `npm version` e sincroniza `Cargo.toml`/`Cargo.lock`, mas para no commit local — push, PR e merge
  são manuais. Só depois do merge, `scripts/tag-release.sh` (`mise run tag`) cria e envia a tag a
  partir da `main` atualizada, o que dispara o workflow.

**Afeta:** `#28` (assinar/notarizar) substitui `signingIdentity: "-"` por uma identidade real e
acrescenta o passo de notarização no mesmo `release.yml` — a estrutura de tag → build → publicação
já fica pronta, só troca o miolo da assinatura. `#32` (builds Windows/Linux) precisa de matriz de
runners e o path `target/release/bundle/dmg/` deixa de ser suficiente sozinho — cada plataforma tem
seu formato de instalável e path próprio.

## #15 — Autocomplete grupo D: linguagens em fences e snippets mermaid

- **Novo `src/editor/fenceCompletions.ts`**: dois níveis de `CompletionSource`.
  `fenceLanguageSource` dispara ao digitar ` ``` ` no início de uma linha e sugere ~24 linguagens
  (lista de cobertura ampla — a string é puramente textual, `#12` já decidiu que não há syntax
  highlighting por linguagem no editor); `mermaidTypeSource` só dispara dentro de um bloco
  ` ```mermaid ` cujo corpo ainda não tem nenhuma linha não-vazia entre a abertura do fence e o
  cursor, e sugere os 7 tipos de diagrama do AC. Aceitar uma linguagem insere o fence **completo**
  (abertura + corpo + fechamento), não só a palavra — deixar o fence aberto quebraria o preview e a
  própria checagem de "dentro de bloco de código" (o lezer-markdown estende um fence não fechado
  até o fim do documento).
- **`from` do 1º nível fica depois das três crases** (`word.from + 3`), diferente do `from` do menu
  `/` da `#14` (que precisava incluir o `/` e por isso usava `filter: false` com filtragem manual).
  Aqui o texto entre `from` e o cursor já é exatamente o prefixo da linguagem digitado, então o
  matcher fuzzy **default** do CM6 funciona sem ajuda — confirmado por teste que a fonte em si
  devolve a lista completa sem filtrar (a filtragem é responsabilidade do pipeline, não da fonte).
- **Supressão do ` ``` ` de fechamento**: `fenceLanguageSource` não dispara quando o início da linha
  atual já está dentro de um `FencedCode`/`CodeBlock` que começou numa linha anterior (`node.from <
  lineStart`) — senão sugeriria linguagem também ao fechar um bloco existente.
- **Encadeamento explícito via `startCompletion`**: o CM6 não reabre o menu de completion sozinho
  depois de aceitar uma opção (a auto-ativação por digitação só reage a `userEvent: "input.type"`;
  inserir uma completion usa `"input.complete"`, que não ativa nada). Novo helper
  `withChainedCompletion(completion)` embrulha o `apply` de uma completion para, depois de inserir
  (string ou snippet), chamar `startCompletion(view)` explicitamente. Usado pelo item `mermaid` do
  1º nível (que insere ` ```mermaid `+corpo vazio e abre o 2º nível) e pelos dois itens do menu `/`
  que a `#14` deixou incompletos de propósito ("Bloco de código" e "Diagrama mermaid") — fechando
  a dívida registrada lá: agora eles inserem só a abertura do fence e encadeiam nos mesmos menus.
- **Achado de implementação**: o `apply`-como-string do wrapper precisa despachar via
  `view.dispatch(view.state.update({changes, selection}))`, não `view.dispatch({changes,
  selection})` direto — a segunda forma (um `TransactionSpec` cru) funciona com uma `EditorView`
  real (que converte internamente), mas quebra o padrão de teste headless herdado da `#14`
  (`option.apply({state, dispatch} as never, ...)`), cujo `dispatch` fake espera receber uma
  `Transaction` já pronta (`tr.state`), não um spec cru. Reproduzido por teste antes do fix
  (`nextState` virava `undefined`).
- **Esqueletos mermaid são texto puro, sem tabstops** — `MERMAID_SKELETONS`, cursor no fim do corpo
  inserido (comportamento default do CM6 para `apply` string). Diagramas de 4-6 rótulos tornariam a
  navegação por Tab cansativa, e strings puras são validáveis direto por `mermaid.parse()`.
- **Achado de ambiente de teste, mesma categoria da `#18`**: jsdom implementa
  `Element.prototype.getClientRects`/`getBoundingClientRect` (retornam retângulos vazios, sem
  lançar), mas **não implementa `Range.prototype.getClientRects`** — usado internamente pelo
  `@codemirror/view` (`textRange(...).getClientRects()`) para medir texto na tela. Qualquer teste
  que deixe uma `EditorView` real completar um ciclo de medição sob jsdom (ex: aguardar o debounce
  assíncrono do autocomplete) lança essa exceção de dentro de um `requestAnimationFrame` interno.
  Stub adicionado em `src/test-setup.ts` (mesmo arquivo/padrão da `#18`), retornando lista vazia.
- **Cobertura de teste em três camadas** (`src/editor/fenceCompletions.test.ts`): fontes headless
  (padrão `CompletionContext` à mão da `#14`); um teste com `EditorView` real provando o
  encadeamento ` ``` ` → `mermaid` → tipo via `currentCompletions(view.state)` (o único jeito de
  provar que `startCompletion` de fato reabre o menu) e a filtragem real via digitação simulada
  (`userEvent: "input.type"`); e `mermaid.parse()` sobre os 7 esqueletos, transformando o critério
  de aceite "renderiza sem erro" em teste automatizado em vez de só verificação manual.

**Afeta:** qualquer issue futura de editor que adicione uma quarta fonte de completion precisa
entrar no mesmo `override: [...]` de `src/editor/slashMenu.ts` (renomeado para exportar
`editorCompletion`) — uma segunda extensão `autocompletion()` substituiria esta configuração em vez
de somar. O stub de `Range.prototype.getClientRects` em `test-setup.ts` fica disponível para
qualquer teste futuro que precise de uma `EditorView`/tooltip real sob jsdom (busca, paleta de
comandos).

## #66 — Zoom da interface (⌘= / ⌘- / ⌘0)

- **Zoom nativo da webview, não CSS**: `getCurrentWebview().setZoom(fator)`
  (`@tauri-apps/api/webview`, permissão `core:webview:allow-set-webview-zoom` adicionada a
  `capabilities/default.json`) escala a página inteira — texto, ícones `size={16}` hardcoded
  (`Toolbar.tsx`), bordas, paddings — como um único ponto de controle. Escalar via CSS foi
  descartado: `--font-size-base` é px absoluto e `--font-size-xs`/`sm` são `rem` presos ao root
  (não ao base), então nenhum dos dois escalaria com uma alteração local; os ícones exigiriam
  refatoração à parte. Verificado que o export PDF (`#27`) não é afetado — `pdf_export.rs` cria uma
  `WebviewWindowBuilder` oculta dedicada, não reusa a webview principal, e a capability é escopada a
  `windows: ["main"]`.
- **Atalhos partidos entre menu nativo e JS, nunca os dois pra mesma tecla** (regra da `#24`: um
  `NSMenuItem` com accelerator intercepta a tecla antes da webview). `⌘=`/`⌘-`/`⌘0` são itens do
  submenu Visualizar (`app_menu.rs`, ids `zoom_in`/`zoom_out`/`zoom_reset`, roteados pelo listener
  `"menu"` já existente em `App.tsx` sem nenhum wiring novo). `⌘⇧+`/`⌘⇧_` (variantes de navegador que
  não têm equivalente de menu — um mesmo `NSMenuItem` só carrega um accelerator) viraram
  `useZoomShortcuts.ts`, espelhando `useTabShortcuts.ts` (`#24`) — e o teste desse hook cobre
  explicitamente que `⌘=`/`⌘-` **não** disparam nada ali, como regressão da regra.
- **Escada de degraus, não escala contínua** (`src/zoom/zoomLevels.ts`): mesmos 11 valores que
  Safari/Chrome/VS Code usam (50% a 200%, mais finos perto de 100%). `nextZoom`/`prevZoom` saturam
  nas pontas (sem wrap); `snapZoom` encaixa qualquer valor solto (inválido ou fora da escada, ex.
  `settings.json` editado à mão) no degrau mais próximo — é o mesmo guard usado tanto na leitura de
  `appSettings.ts` quanto internamente pra achar o índice atual antes de avançar/recuar.
- **Persistido em `settings.json`** como campo `zoom: number` de topo em `AppSettings` — não
  aninhado, então `patchAppSettings`'s `{...patch}` já cobre sem precisar de merge dedicado (ao
  contrário de `layout`/`explorer`, que são objetos). `zoomStore.ts` segue o mesmo formato de
  `layoutStore.ts` (`#19`): `set` local imediato + `patchAppSettings` com `try/catch` que só loga se
  a escrita falhar, sem travar o zoom em si.
- **Indicador na status bar só quando ≠ 100%** (`{Math.round(zoom*100)}%`) — mesmo espírito do save
  state (`#60`): sempre útil, nunca ruidoso. Novo `<span className="status-bar-right">` agrupa
  zoom + save state num único item flex, pra `justify-content: space-between` da `.status-bar` não
  reacomodar os 3 possíveis filhos quando o indicador de zoom aparece/some.
- Sem teste automatizado para `app_menu.rs` — mesma postura já registrada na `#24` pra integração
  nativa sem precedente de teste no repo; verificação manual via `mise run dev`, incluindo o
  comportamento do CodeMirror (re-medição de caractere após zoom) e do scroll sync (`#20`) em zoom
  ≠ 100%, nenhum dos dois testável sob jsdom.

**Afeta:** `#29` (tela de preferências, ainda não existe) ganharia o zoom como mais um item a
migrar pra lá, junto de tema e largura de leitura — mesmo padrão já antecipado pela `#60`. `#32`
(Windows/Linux) perde o menu nativo do macOS: sem ele, `⌘=`/`⌘-`/`⌘0` precisariam virar listener JS
também, e `useZoomShortcuts.ts` vira o dono de todas as variantes, não só das com Shift.

## Skill `/release` + tag automática pós-merge (trabalho de processo, sem issue)

- **Fecha o ciclo aberto pela `#63`**: até aqui, depois de `mise run release`, o push, a abertura do
  PR e o `mise run tag` pós-merge eram manuais — repetido à mão nas duas releases já feitas
  (`v0.1.0-rc.1`, `v0.1.0`). A skill `.claude/skills/release/SKILL.md` (invocada como `/release`)
  cobre a metade local: lê os merges desde a última tag (`git log <tag>..HEAD --merges --pretty=
  format:"- %b"`, corpo do commit de merge do GitHub = título do PR), sugere a versão por heurística
  simples sobre esses títulos (feature nova → minor, só fix/chore → patch — não Conventional
  Commits, o histórico do repo não segue esse padrão), confirma com o usuário via `AskUserQuestion`,
  roda o gate local (`lint && typecheck && test` — `release.yml` não repete isso, só valida
  tag×versão), chama `mise run release <versão>` (reaproveita `scripts/prepare-release.sh` sem
  mudança) e abre o PR.
- **Achado crítico que molda a metade automática**: confirmado na documentação do GitHub Actions —
  eventos disparados pelo `GITHUB_TOKEN` padrão de um workflow, **incluindo push de tag**, não
  disparam outros workflows (proteção anti-recursão). Um job que detectasse o merge do PR e desse
  `git push` numa tag usando o token padrão **não acionaria sozinho** `release.yml` (que escuta
  `push: tags`). As únicas exceções documentadas são `workflow_dispatch`/`repository_dispatch`, que
  sempre disparam mesmo vindos do token padrão, desde que ele tenha permissão `actions: write`.
  Fontes: [Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
  [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token).
- **Solução sem PAT novo**: novo `.github/workflows/auto-tag.yml`, gatilho `pull_request: closed`
  filtrado por `merged == true && head.ref` começando com `chore/release-v` (o mesmo padrão de nome
  que `prepare-release.sh` já cria — sinal intencional, sem exigir label nova no GitHub). O job cria
  e envia a tag (registro histórico normal, idempotente — pula se a tag já existir, útil pra reruns
  ou pra quando alguém já tagueou na mão) e **dispara explicitamente**
  `gh workflow run release.yml --ref vX.Y.Z`, furando a proteção via a exceção do
  `workflow_dispatch`. `release.yml` só ganhou esse trigger a mais — o job de build/publicação
  existente da `#63` não mudou uma linha.
- **Achado por dogfooding, corrigido antes do merge**: o prefixo original do filtro era só
  `chore/release-` (sem o "v") — e a própria branch deste trabalho,
  `chore/release-skill-and-auto-tag`, batia nele. Mergear este PR teria disparado
  `auto-tag.yml` de verdade (a tag `v0.1.0` já existente seria pulada pela idempotência, mas o
  `gh workflow run release.yml --ref v0.1.0` ainda assim rodaria, republicando uma release que já
  existe). Corrigido de duas formas: o prefixo virou `chore/release-v` (mais específico, casa só com
  o padrão real de `prepare-release.sh`), e o job ganhou uma segunda guarda independente do nome da
  branch — compara `package.json` no commit de merge (`HEAD`) contra o pai que era a ponta da `main`
  antes do merge (`HEAD^1`, com `git show HEAD^1:package.json`) e só segue adiante se a versão
  realmente mudou. As duas guardas juntas cobrem tanto "nome de branch coincidente" quanto "branch
  certa, mas sem bump de verdade".
- **`runs-on: ubuntu-latest`** no job de tag (não `macos-latest`) — só lê `package.json`, cria/envia
  a tag e chama a API de workflow via `gh`, nenhuma dependência de Rust/Xcode. O job de build em
  `release.yml` continua `macos-latest`.
- **`mise run tag`/`scripts/tag-release.sh` viram fallback**, não são removidos — se o workflow
  automático falhar (ex: runner fora do ar), dá pra taguear na mão sem esperar debug do CI.

**Afeta:** qualquer issue futura que mexer em `release.yml` (`#28`, assinar/notarizar; `#32`,
Windows/Linux) precisa lembrar que agora existem dois gatilhos (`push: tags` e `workflow_dispatch`)
alimentando o mesmo job de build — mudanças no `on:` ou nos outputs esperados de `$GITHUB_REF_NAME`
afetam os dois caminhos igualmente.

## Refresh visual do layout (sem issue)

- **Só camada visual**: nenhuma mudança de comportamento, store ou atalho. O grosso vive em
  `tokens.css`, `App.css`, `PreviewPane.css` e `editorTheme.ts`; nos componentes, só ícones
  (`lucide-react`, já dependência desde a `#60`) e marcações para CSS (`aria-current`,
  `data-state`).
- **Paleta**: neutros levemente quentes, chrome (barra do topo, sidebar, status bar) um tom abaixo
  da área de escrita. O accent deixa de ser o azul de link do GitHub (`#22`) e vira um índigo
  (`#4f5bd5`/`#8b95ff`), ainda único. Tokens novos: `--color-surface-hover`, `--color-accent-soft`,
  `--color-focus-ring` (opaco, igual ao accent, para manter contraste ≥ 3:1 no anel de foco), `--color-success`, `--color-warning`, `--color-markdown-code-text`,
  `--shadow-sm`, `--transition-fast`. Hover usa overlay translúcido (`--color-surface-hover`) em vez
  de `--color-surface-elevated`, que no tema escuro ficava invisível sobre a sidebar.
- **Abas em pílula** (ativa elevada com sombra leve), `×` só na aba ativa/sob o mouse, ponto de
  não-salvo no accent. Botões ativos da toolbar (`aria-pressed`) em accent suave.
- **Explorador**: cabeçalho "Arquivos", chevron/pasta/arquivo com ícones, e o arquivo da aba ativa
  destacado (`aria-current`, seletor booleano por nó — mesma assinatura por item da `#25`).
- **Status bar**: ponto colorido no estado de salvamento (verde salvo, âmbar não salvo, accent
  pulsando ao salvar), via `data-state`; o texto continua o mesmo, testes intactos.
- **Preview**: tipografia própria para títulos, código inline/bloco, citação, links, `hr`, imagens e
  tabelas arredondadas — antes ficava nos defaults do navegador. Como `PreviewPane.css` é inlinada
  no export (`#26`/`#27`), o HTML/PDF exportado herda o mesmo visual.
- **Editor**: padding lateral e entrelinha 1.7 via `editorTheme.ts`. O padding vertical fica
  pequeno de propósito: o scroll sync (`#20`) usa `lineBlockAt().top`, que ignora esse deslocamento.
- Título de `index.html` passou a ser `scrible`. `titleBarStyle: "Overlay"` do Tauri (barra de
  título integrada) ficou de fora: exige região de arraste e recuo para os semáforos do macOS, a
  validar no app nativo.

**Afeta:** issues de UI futuras devem usar `--color-surface-hover` para hover e
`--color-accent-soft` para estados ativos, em vez de `--color-selection-bg`.

## Checagem e instalação de atualizações (sem issue)

- **`tauri-plugin-updater` + `tauri-plugin-process`**, decisão via sabatina (contra só abrir o
  `.dmg` no navegador). O updater baixa `scrible.app.tar.gz`, confere a assinatura minisign com a
  `pubkey` de `tauri.conf.json` e troca o `.app` no lugar; `relaunch()` reinicia. Essa assinatura
  é independente da Apple — funciona com a assinatura ad-hoc da `#63`, e como o download é feito
  pelo próprio app (não por um navegador) não ganha o atributo de quarentena do Gatekeeper.
  Exigiu subir o `tauri` de 2.11 para 2.12 (dependência do plugin 2.14) e, junto, `@tauri-apps/api`
  e `@tauri-apps/cli`, que precisam acompanhar o minor do crate.
- **Chave do updater**: privada no secret `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`), pública em
  `plugins.updater.pubkey`. Perder a privada significa que nenhuma instalação existente aceita mais
  atualizações — ela precisa ser guardada fora do GitHub também. Com `createUpdaterArtifacts: true`,
  todo `tauri build` (inclusive `mise run build` local) exige a chave privada no ambiente.
- **Endpoint `releases/latest/download/latest.json`** do próprio GitHub, sem servidor: o
  `release.yml` gera o manifesto (`darwin-aarch64` só, mesma restrição da `#63`) com `jq` e publica
  junto do `.dmg`. "latest" do GitHub nunca é uma pre-release, então tags com `-` (`v0.3.0-rc.1`)
  nunca são oferecidas pelo updater. `requireSignedVersion` ficou desligado: não foi confirmado
  que o CLI atual grava a versão no comentário confiável da assinatura; ligá-lo sem isso
  rejeitaria toda atualização.
- **Quando checa**: na abertura (`App.tsx`, silenciosa — sem versão nova ou sem rede, nada
  aparece) e pelo item "Procurar atualizações…" no submenu de app (`app_menu.rs`, id
  `check_updates`, roteado pelo `registry.ts` da `#60`), que sempre responde (versão nova, "já está
  na mais recente" ou o erro). Se uma checagem manual já estiver em curso, a da abertura descarta o
  próprio resultado.
- **Aviso**: `src/updater/UpdateBanner.tsx`, faixa não-modal no mesmo padrão do `ConflictBanner`
  (`#10`), em `--color-accent-soft` (informação, não alerta). "Atualizar e reiniciar" roda o mesmo
  `flushAll()` do Cmd+Q (`#7`/`#24`) antes de baixar; progresso em % (ou MB, se o servidor não
  mandar o tamanho). "Ver novidades" abre a página da release via `plugin-opener`.
- **"Pular esta versão"** grava `skippedVersion` em `settings.json` (`AppSettings`, campo de topo,
  `patchAppSettings` sem merge dedicado — mesmo caso do `zoom` da `#66`). Só a checagem da abertura
  respeita; a do menu oferece a versão pulada mesmo assim.
- O `Update` devolvido por `check()` segura um resource no Rust: fica fora do estado zustand
  (`updateStore.ts`, variável de módulo) e é fechado (`close()`) sempre que o aviso some sem
  instalar.
- **Transição**: versões anteriores a esta não têm o updater — a primeira com ele precisa ser
  instalada pelo `.dmg` uma última vez.

**Afeta:** `#28` (assinar/notarizar) não muda o updater — a assinatura minisign continua por cima
da da Apple. `#32` (Windows/Linux) precisa acrescentar as plataformas no `latest.json` e o pacote de
updater de cada uma (`.msi`/`.AppImage` + `.sig`) no `release.yml`.

## Modo só visualização e ciclo de modos com ⇧⌘P (sem issue)

- **`viewMode: "editor" | "split" | "preview"` substitui o booleano `previewVisible`** da `#19`
  em `AppSettings.layout` e no `layoutStore`. `appSettings.ts` migra o campo antigo na leitura
  (`false` → `"editor"`, `true` → `"split"`); valor desconhecido cai em `"split"`. O arquivo passa
  a ser gravado só com `viewMode`.
- **⇧⌘P agora cicla os 3 modos** (editor → lado a lado → visualização → editor), em vez de
  alternar o preview — mesmo accelerator nativo da `#24`, item renomeado para "Alternar modo de
  exibição" (id `cycle_view_mode`). O submenu Visualizar ganhou "Modo de exibição" com os 3 modos
  diretos (`view_editor`/`view_split`/`view_preview`), sem accelerator, no mesmo formato do submenu
  Tema. Na toolbar, o botão que era "Alternar preview" mostra o ícone do modo atual e cicla ao
  clicar (sem `aria-pressed`, não é mais um liga/desliga).
- **No modo só visualização o editor continua montado**, só que `inert`, `visibility: hidden` e
  `position: absolute` na largura cheia (`.editor-pane.is-hidden`). Desmontar perderia a
  `EditorView` única da `#21`; `display: none` deixaria o editor sem caixa, então o sync de scroll
  (`#20`, que continua ligado nesse modo) não conseguiria movê-lo e, ao voltar pra edição, ele
  estaria longe do trecho que estava sendo lido.
- **`useScrollSync` alinha o preview com o editor uma vez sempre que é ligado** (boot ou saída do
  modo só editor), não só no próximo scroll: indo de só editor direto pra só visualização, o
  preview remontava no topo do documento com o editor já oculto.
- **Saindo do modo só visualização o foco volta pro editor**; "Buscar" (⌘F) nesse modo troca pra
  lado a lado e só abre o painel depois do render que torna o editor visível
  (`SplitLayout.openSearch`).

**Afeta:** o `previewVisible` citado na `#19` não existe mais — código novo deve ler `viewMode`.
A paleta de comandos (issue B da `#60`) já encontra os 4 comandos de modo no `registry.ts`.

## Item "Sobre o scrible" no menu do app (sem issue)

- **`PredefinedMenuItem::about`, não um item customizado**: usa o painel nativo de cada SO, sem
  UI nova nem evento JS. É o primeiro item do submenu "scrible" em `app_menu.rs`.
- **Nome e versão vêm de `app.package_info()`**, que o Tauri preenche a partir do `package.json`
  (via `tauri.conf.json`) — continua valendo que a versão vive só lá. O autor vem de `authors` no
  `Cargo.toml` (`CARGO_PKG_AUTHORS`), com fallback "Eduardo Hitek" se estiver vazio.
- **O painel do macOS ignora `AboutMetadata.authors`**, então o autor também vai em `credits`
  ("Autor: …"), que é o campo exibido lá. Testes cobrem só o parse de autores; o painel em si é
  verificação manual (mesma postura da `#24`).

**Afeta:** nada pendente. Se o autor mudar, é só o `authors` do `Cargo.toml`.

## #32 (PR 1) — App multiplataforma, CI em 3 SOs e modo de teste do release

Plano fechado via sabatina (matriz, instaladores e updater ficam para o PR 2).

- **Paths no Windows**: o Rust devolve `C:\Users\…`, mas o frontend monta/compara caminhos com `/`
  (`lastIndexOf("/")`, `startsWith(`${dir}/`)`, rename de pasta, roteamento do watcher). Todo path
  que entra do Rust ou do diálogo de abrir passa por `normalizePath` (`src/fs/paths.ts`) na
  fronteira — só no Windows (`isWindows()`), porque em macOS/Linux `\` é caractere válido de nome (`workspace_status` em `App.tsx`/`appSettings.ts`, `openFileDialog`). O Rust aceita `/`
  no Windows, então o path normalizado volta sem conversão. O hash do histórico (`#8`) é por string
  do path; Windows é instalação nova, então não há migração.
- **Workspace no Linux**: `document_dir()` falha sem XDG user-dirs; `workspace::bootstrap` cai para
  `~/Documents`. Com XDG configurado (ex.: `~/Documentos`), ele tem prioridade.
- **Tecla primária**: `src/platform/platform.ts` (`isMac`, `hasPrimaryModifier`, `formatShortcut`),
  sem dependência nova. `useTabShortcuts`/`useZoomShortcuts` usam `ctrlKey` fora do macOS; os
  rótulos de `registry.ts` viram `Ctrl+T`, `Ctrl+Shift+P`… Menu (`CmdOrCtrl+…`) e CodeMirror
  (`Mod-`) já se adaptavam. `navigator.platform` é vazio no jsdom: testes que dependem de
  plataforma forçam o valor (`vi.spyOn(navigator, "platform", "get")`; o registry precisa de
  `vi.hoisted` porque decide `export_pdf` em tempo de import).
- **Menu igual nas três plataformas** (inclusive o submenu "scrible"). Consequência: a previsão da
  `#66` de que o zoom viraria listener JS fora do macOS não se confirmou — `Ctrl+=`/`-`/`0`
  continuam vindo do accelerator do menu. Se menu e listener JS disparam juntos no Windows/Linux
  não está confirmado; faz parte do checklist de validação manual.
- **Exportar PDF escondido fora do macOS**: `mod pdf_export` e o item de menu só sob
  `cfg(target_os = "macos")`; comando do registry e item do `ExportMenu` só com `isMac()`.
  Follow-up: implementar via WebView2 `PrintToPdf` / impressão do WebKitGTK.
- **CI** (`ci.yml`): matriz macOS, `ubuntu-22.04` e `windows-latest`, com as libs do WebKitGTK no
  Linux para o clippy compilar.
- **Modo de teste do `release.yml`**: `workflow_dispatch` com `dry_run` builda as 5 plataformas
  (macOS arm64, Windows x64/arm64, Linux x64/arm64, builds nativos) e sobe os instaladores como
  artefatos, sem checar tag nem publicar. Sem `dry_run`, só o macOS é publicado, como antes.
  `--bundles` por plataforma na linha de comando, sem tocar no `"targets": "all"` global.
- **Observação de ambiente**: `workspace::tests::reports_permission_denied_on_existing_readonly_dir`
  falha quando os testes rodam como root (root ignora `0o500`) — já falhava em `main`; não é regressão.

**Afeta:** `#32` PR 2 (publicação das 3 plataformas, `latest.json` com 5 chaves, corpo da release,
README), issue de follow-up do PDF, e qualquer código novo que monte paths (usar `normalizePath`
em tudo que vier do Rust/diálogos).

## #32 (PR 2) — Release das 3 plataformas e updater multiplataforma

- **`release.yml` com matriz + job `publish`**: o job `build` (5 plataformas, builds nativos) só sobe
  os instaladores como artefatos (`scrible-<plataforma>`); o job `publish` (`needs: build`, pulado em
  `dry_run`) baixa tudo, roda `scripts/build-release-assets.sh` e publica com
  `softprops/action-gh-release`. Sem `tauri-action` — decisão da sabatina, mantém o controle do
  `latest.json` e do `SHA256SUMS.txt` (um único, cobrindo todos os arquivos).
- **`scripts/build-release-assets.sh`** (bash + jq, testado com uma árvore falsa de artefatos): acha
  exatamente um pacote do updater por plataforma e o `.sig` correspondente (falha se achar 0 ou >1),
  recusa nomes de asset repetidos entre plataformas (o bundler já diferencia arquitetura no nome:
  `x64`/`arm64`, `amd64`/`arm64`, `aarch64`) e gera o `latest.json` com as 5 chaves: `darwin-aarch64`,
  `windows-x86_64`, `windows-aarch64`, `linux-x86_64`, `linux-aarch64`.
- Pacote do updater por plataforma: macOS `scrible.app.tar.gz` (inalterado), Windows `*-setup.exe`,
  Linux `*.AppImage`, cada um com `.sig`. O `.deb` não se atualiza pelo app — o corpo da release diz
  isso. A chave `darwin-aarch64` continua igual, então clientes antigos não percebem a mudança.
- Corpo da release com seções por plataforma (Gatekeeper, SmartScreen, `chmod +x`/`apt install`).
  README e descrição da task `build` atualizados.
- **Validação**: depois do merge, uma tag `vX.Y.Z-rc.1` (mesmo precedente da `#63`) e o teste do
  updater de uma rc para outra em pelo menos Windows e Linux. Authenticode segue fora de escopo.

**Afeta:** `#28` (notarização) só mexe no passo de build do macOS; qualquer nova plataforma/formato
entra na lista `platforms` de `build-release-assets.sh` e na matriz do `build`.

### Bugfix pós-merge (#32): `check-version.sh` quebrava no Windows

A primeira release de teste (`v0.6.0-rc.1`) falhou nos dois jobs Windows em `check-version.sh`: no Git
Bash o `$repo_root` vira `/d/a/scrible/scrible`, caminho que o Node (binário nativo do Windows) não
resolve em `require('$repo_root/package.json')`. O `dry_run` não pegou porque ele pula esse passo.
Fix: `cd "$repo_root"` e `require('./package.json')`. Como a tag `v0.6.0-rc.1` já aponta para o script
antigo (e reescrever tag está fora de questão), a validação continua em `v0.6.0-rc.2`; a rc.1 ficou sem
release publicada (o job `publish` não rodou). **Lição:** passo que só roda com tag não é coberto pelo
`dry_run` — o `dry_run` deveria exercitar também a checagem de versão (contra a versão atual, sem tag).

## #81 — Exportar PDF no Windows e no Linux

- **Um comando, três motores**: `export_pdf` existe nas três plataformas. macOS segue com
  `WKWebView.createPDF`; Windows usa `ICoreWebView2_7::PrintToPdf` e Linux usa
  `WebKitPrintOperation` com a "impressora" `Print to File` (sem diálogo), ambos A4 com fundos.
  O nome da impressora vem de `dgettext("gtk30", …)`, porque o GTK o traduz (pt-BR incluso).
  Item de menu (`app_menu.rs`), `ExportMenu.tsx` e `registry.ts` voltaram a aparecer em todas.
- **HTML via arquivo temporário + `file://`**, não `NavigateToString`: o WebView2 limita a 2 MB e
  documentos com vários diagramas mermaid em SVG passam disso. O fim do load vem de `on_page_load`.
  Os temporários (`.html` e `.pdf`) são apagados em qualquer desfecho.
- **Verificação**: Linux foi exercitado de verdade sob xvfb (PDF válido gerado). Windows só compila
  no CI — o `PrintToPdf` numa janela oculta precisa de verificação manual num Windows real.

**Afeta:** nada pendente além da verificação manual no Windows.

## #9 — Persistência e restauração de sessão (abas)

- **Backend**: novo `src-tauri/src/session.rs` com `Session { tabs: [{ path, cursorPos, scrollTop }], activeTabIndex }`
  (serde `camelCase`) em `.scrible/session.json`, e dois commands (`read_session`, `write_session`). Escrita
  atômica (tmp + fsync + rename, mesmo padrão de `fs_ops::save_file`). **Não** reaproveita `settings.json`/
  `appSettings.ts` (#19): sessão tem ciclo de escrita e formato próprios, e misturar traria o
  read-merge-write de volta.
- **Tolerância a falhas na leitura** (`session::load`): arquivo ausente (primeira execução) ou corrompido
  devolve sessão vazia — nunca bloqueia o boot. Abas cujo arquivo não existe mais são descartadas **no
  Rust** (com `eprintln!` de aviso) e `activeTabIndex` é reapontado para a mesma aba depois da filtragem
  (ou `0`, se a própria aba ativa sumiu). Filtrar lá (e não no frontend) evita que `initDocument`
  recrie por engano o arquivo apagado (seu ramo `NotFound` cria o arquivo com o conteúdo de fallback).
- **Posição do cursor/scroll**: `editorStateRegistry.ts` passou a manter `cursors` (offset do cursor, via
  `updateListener` — `selectionSet || docChanged`) ao lado de `scrollTops`, e expõe `getPosition`,
  `seedPosition` e `subscribePositions`. O scroll é gravado por um listener em `view.scrollDOM`
  (`EditorPane`). Cursor é **offset de caracteres** (não linha/coluna), limitado ao tamanho do documento
  na criação do `EditorState`; scroll é `scrollTop` em pixels — "linha correta" é o mínimo do AC e o
  cursor garante isso mesmo que o scroll em px derive após mudar zoom/largura da janela.
- **Ordem de boot** (`App.tsx`): `restoreSession()` → `tabsStore.restoreTabs()` carrega **todos** os
  documentos antes de ativar a aba (o `EditorPane` monta já com conteúdo final; senão a reconciliação de
  conteúdo substituiria o doc e perderia cursor/scroll). Sem sessão, cai no fluxo antigo
  (`untitled.md` com `DEFAULT_DOCUMENT`). O guard `bootstrappedRef` existe porque o StrictMode (dev)
  roda o efeito duas vezes e restaurar duas vezes duplicaria as abas.
- **Armadilha de scroll**: logo após montar/trocar de aba o layout do CodeMirror ainda não foi medido e o
  DOM clampa o `scrollTop` restaurado. `EditorPane` reaplica o alvo num `requestAnimationFrame` e, enquanto
  isso, ignora eventos de scroll (e o cleanup do StrictMode) para não sobrescrever o valor salvo com o
  clampado.
- **Persistência** (`src/session/session.ts`): `startSessionPersistence()` só roda **depois** da
  restauração (salvar antes apagaria a sessão anterior). Debounce de 2s via `setTimeout`, disparado por
  qualquer mudança em `tabsStore` ou no registry; não regrava se o JSON serializado for idêntico ao
  último gravado; nunca grava lista de abas vazia. "Mover cursor/scroll significativamente" da issue
  virou "qualquer mudança, com debounce" — mais simples e o custo é desprezível. `flush()` é chamado no
  blur da janela e no handshake de fechamento (`app-close-requested`), antes de `quit_app`.
- Sem teste de integração do `EditorPane` com scroll real (jsdom não faz layout); cobertura em
  `session.test.ts`, `editorStateRegistry.test.ts` e nos testes Rust de `session.rs`.

**Afeta:** qualquer issue que mude o shape de `Tab` ou crie outra fonte de abas abertas precisa manter
`collectSession()` em sincronia. O watcher continua observando só `untitled.md` (dívida de `#21`): abas
restauradas de outros arquivos não recebem alteração externa em tempo real.

## #31 — Autocomplete grupo C: caminhos de arquivos e imagens

- Links sugerem **todos os arquivos visíveis, priorizando `.md`**; imagens só `.png`, `.jpg`,
  `.jpeg`, `.gif`, `.svg` e `.webp` (case-insensitive). Decisão confirmada com o usuário, resolvendo
  a diferença entre o contexto técnico e o primeiro critério de aceite da issue.
- `file_index.rs` percorre a raiz do workspace recursivamente, sem ler conteúdo, ignorando ocultos,
  temporários `.scrible-tmp` e symlinks (evita ciclos/saídas do workspace). O novo command
  `list_workspace_files` roda em `spawn_blocking`; nenhum scan acontece durante a digitação.
- `src/workspace/fileIndex.ts` mantém um snapshot em memória; o evento **existente**
  `workspace-tree-changed` (#25) atualiza o explorador e esse índice. Não foi criado outro watcher.
  Scans concorrentes são coalescidos, com uma nova passagem se houver eventos durante a anterior;
  consultas usam o snapshot anterior durante refresh, e falhas preservam esse snapshot.
- A quarta fonte entra no mesmo `autocompletion({ override })` de `slashMenu.ts` (#14/#15).
  `createEditorCompletion` recebe uma função que consulta o path atual **da aba** no documentStore,
  cobrindo rename sem remontar o editor. Só dispara no destino inline de link/imagem, fora de
  código, destinos remotos, absolutos e âncoras. Setas/Enter/Esc vêm do CodeMirror.
- Sugestões exibem paths relativos legíveis; a inserção codifica cada segmento como URL (inclusive
  espaços, parênteses, `%` e `#`), mantendo a sintaxe Markdown válida. `src/fs/linkPaths.ts` é a
  implementação compartilhada de paths relativos e resolução lexical, usando `/` como na #32.
- O preview passa a receber `documentPath`/`workspaceRoot`. Depois da sanitização, imagens locais
  são convertidas com `convertFileSrc`; o protocolo asset é habilitado com escopo dinâmico **só da
  raiz real do workspace**, incluindo o fallback de Documents do Linux. Links `.md` abrem abas;
  outros arquivos abrem no aplicativo padrão via `open_workspace_file`, que valida arquivo
  existente e caminho canônico dentro do workspace. URLs remotas e âncoras mantêm o comportamento.
- Links `.md` passam antes por `check_workspace_file`: `openTab`/`initDocument` **criam** arquivos
  ausentes (fluxo de "novo arquivo"), e um link quebrado não pode virar arquivo vazio no disco — o
  clique só registra o erro. `open_workspace_file` recusa extensões que executam código ao abrir
  (`.command`, `.pkg`, `.sh`, `.exe`, `.js`, `.webloc`… lista em `file_index.rs`) e, no Unix,
  arquivos sem extensão com bit de execução (o macOS os roda no Terminal): Markdown de terceiros
  não pode executar nada com um clique no preview.
- Troca de documento invalida imediatamente o source debounced do preview, para não resolver os
  links da aba anterior contra o path novo. Exports continuam consumindo o pipeline original,
  sem URLs asset do preview; embutir imagens em HTML/PDF exportados é outro escopo.
- Verificação automatizada: índice com 600 arquivos, refresh concorrente/falhas, filtragem/inserção,
  teclado com EditorView real, preview e paths entre pastas. O app de desenvolvimento compilou e
  iniciou; inspeção visual não foi possível porque Computer Use não tem permissão neste ambiente.

**Afeta:** fontes futuras de autocomplete devem usar a mesma factory/override. Novos consumidores
podem reutilizar o índice sem outro watcher; imagens locais fora do workspace continuam fora do
escopo do protocolo asset desta issue.

## #29 — Live preview nível 3 (ocultar marcadores fora da linha do cursor)

- **Opt-in, default desligado (nível 2)**: a issue pede opção desligável e aponta risco de UX na
  navegação por teclado; sem verificação manual extensiva ainda, o default continua o comportamento
  de `#12`. Preferência `hideMarkers: boolean` em `settings.json` (via `patchAppSettings`, `#19`),
  alternada pelo botão `EyeOff` da toolbar / comando `toggle_hide_markers`. **Não há tela de
  "Preferências"** no app — o AC "nas preferências" foi atendido com o toggle da toolbar, o mesmo
  lugar do tema; sem item no menu nativo (exigiria sincronizar estado marcado no Rust).
- `markdownDecorations(hideMarkers)` devolve uma de duas instâncias fixas de `ViewPlugin`
  (`level2`/`level3`), trocadas em runtime por um `Compartment` em `editorStateRegistry.ts`
  (`livePreviewEffect`). `EditorPane` despacha o efeito na view montada; abas em segundo plano são
  alinhadas em `getOrCreateEditorState` (comparação por identidade da extensão no compartment), sem
  tocar no doc — undo/redo e seleção por aba preservados (`#21`).
- Esconder = `Decoration.replace({})` sem widget: o documento nunca muda, então copiar, autosave e
  preview usam o markdown real. O critério de revelar é a **linha inteira** tocada por qualquer range
  da seleção (não o nó) — marcadores nunca aparecem/somem sob o cursor enquanto ele anda na mesma
  linha, e seleção multi-linha revela todas as linhas cobertas. Plugin também provê
  `EditorView.atomicRanges` com os ranges escondidos.
- Escondidos: `HeaderMark` (+ espaço seguinte, só no início da linha), `EmphasisMark`,
  `StrikethroughMark`, `CodeMark` de `InlineCode`, e `LinkMark`/`URL`/`LinkTitle` de `Link` com URL
  inline. **Sempre visíveis**: fences de código, imagens, links por referência, citação e marcadores de lista.
- Verificação: testes headless com `EditorView` em jsdom (`markdownDecorations.test.ts`), incluindo
  percorrer todas as posições do cursor sem alterar o doc. **Teste manual de navegação por setas
  em `mise run dev` não foi feito nesta sessão** (ambiente de nuvem sem GUI) — recomendado antes de
  considerar mudar o default.

**Afeta:** qualquer issue que adicione um nó de marcador novo a `markdownDecorations.ts` (decidir se
entra em `hiddenRange`); a próxima chave de `settings.json` segue usando `patchAppSettings`.

## #102 — Ponto de entrada para arquivos vindos de fora do app (spec #101)

- **Validação de path vinda do SO** (revisita a ressalva da `#6`): `validate_open_paths`
  (`src-tauri/src/open_paths.rs`) só aceita arquivo regular existente (`metadata().is_file()`, segue
  symlink) com extensão `.md`/`.markdown` (sem diferenciar maiúsculas). Rejeitados são descartados
  com `eprintln!`, sem erro para o frontend. Os commands genéricos da `#6` continuam sem validar —
  a regra vale só para a fronteira "path vindo de fora do processo", não restringe ao workspace.
- **Ponto de entrada único** no frontend: `tabsStore.openExternalPaths(paths)` — `normalizePath` na
  fronteira, valida no Rust e abre cada path via `openTab` (dedup: path já aberto só foca). O último
  aceito vira a aba ativa. `openFileDialog` não passa por aqui: o path vem de um diálogo do próprio
  app, já filtrado.
- **Fila no boot**: até `markExternalOpenReady()`, `openExternalPaths` só enfileira em
  `pendingExternalPaths` (sem validar). O boot (`App.tsx`) roda `restoreSession()` → consome
  `take_pending_open_paths` (paths que o Rust guardou em `PendingOpenPaths` antes de o webview estar
  pronto) → `markExternalOpenReady()` aplica tudo → só então `startSessionPersistence()`. As abas
  novas entram na sessão pelo `collectSession()` normal.
- **Contrato com os emissores nativos** (sub-issues de cada SO): com o app aberto, emitir o evento
  `open-paths` (payload `string[]`); antes de o frontend estar pronto, guardar em `PendingOpenPaths`.

**Afeta:** `#103` (emissor macOS) e as specs de Windows/Linux (linha de comando / segunda instância),
que só precisam entregar paths por `open-paths`/`PendingOpenPaths`.

## #103 — "Abrir com" no macOS: `RunEvent::Opened` (spec #101)

- `run()` passou de `.run(generate_context!())` para `.build(...).run(handle_run_event)`.
  `RunEvent::Opened { urls }` (só `cfg(target_os = "macos")`) vira paths via
  `open_paths::file_urls_to_paths` (só `file://`, decodifica percent-encoding).
- **Quem decide entre fila e evento é o Rust**: `PendingOpenPaths` guarda `frontend_ready`, que
  `take_pending_open_paths` liga. Antes disso os paths são enfileirados; depois, são emitidos em
  `open-paths` e a janela `main` é desminimizada, mostrada e focada. Checar e enfileirar sob o mesmo
  lock evita perder paths que cheguem durante o `take`. Um reload do webview (dev) não reabre a
  fila — o frontend novo recebe `[]`, e os próximos paths chegam por evento.
- `PendingOpenPaths` é gerenciado no `Builder` (não no `setup`): ao abrir o app fechado por
  "Abrir com", o `Opened` pode chegar antes do `setup`, e `app.state()` entraria em pânico.

**Afeta:** specs de Windows/Linux podem reaproveitar `PendingOpenPaths::enqueue_unless_ready`
(hoje sob `cfg(macos|test)`, para não gerar código morto no clippy dessas plataformas).

## #104 — `fileAssociations` no bundle do macOS (spec #101)

- `bundle.fileAssociations`: `ext: ["md", "markdown"]`, `contentTypes: ["net.daringfireball.markdown"]`,
  `role: "Editor"`, `rank: "Alternate"`. O `Info.plist` gerado sai com `CFBundleDocumentTypes` e
  `LSHandlerRank = Alternate` — o scrible aparece em "Abrir com", mas nunca vira padrão sozinho.
  Vale para todas as plataformas no config; Windows/Linux ganham o registro do instalador, mas ainda
  não têm emissor (linha de comando / segunda instância ficam nas specs deles).
- **Como validar sem tocar no app instalado nem na sessão real**: buildar o `.app` num worktree limpo
  com `--config '{"identifier":"com.hitek.scrible.e2e","bundle":{"createUpdaterArtifacts":false}}'`
  (identificador próprio, então o Launch Services não roteia para o scrible instalado) e abrir com
  `open -a <app> --env HOME=<home temporário> arquivo.md`. O `HOME` falso isola workspace e
  `session.json`, que serve de evidência (abas + `activeTabIndex`). Ao final, `lsregister -u` nos
  bundles de teste. `open -a` entrega o mesmo `kAEOpenDocuments` do "Abrir com" e do Dock.
