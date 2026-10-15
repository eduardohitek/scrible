# scrible

[![CI](https://github.com/eduardohitek/scrible/actions/workflows/ci.yml/badge.svg)](https://github.com/eduardohitek/scrible/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/eduardohitek/scrible?include_prereleases)](https://github.com/eduardohitek/scrible/releases)

Editor de markdown com interface limpa, preview em tempo real (incluindo diagramas [mermaid](https://mermaid.js.org/)) e autosave — feito inicialmente para macOS, com portabilidade planejada para Windows e Linux.

## Download e instalação

Builds prontos ficam na [página de releases](https://github.com/eduardohitek/scrible/releases) — baixe o `.dmg` mais recente.

> **Apple Silicon (arm64) apenas**, por enquanto — builds para Intel/Windows/Linux estão no backlog ([#32](https://github.com/eduardohitek/scrible/issues/32)).

O `.dmg` é assinado apenas com **assinatura ad-hoc** (sem conta de desenvolvedor Apple — assinatura e notarização de verdade estão em [#28](https://github.com/eduardohitek/scrible/issues/28)). Ao abrir o app pela primeira vez, o macOS vai avisar que não foi possível verificar o desenvolvedor:

1. Abra o `.dmg` e arraste o `scrible.app` para `Applications`.
2. Tente abrir o app — o macOS vai bloquear.
3. Vá em **Ajustes do Sistema → Privacidade e Segurança**, role até a mensagem sobre o scrible e clique em **Abrir Mesmo Assim**.

Cada release traz um `SHA256SUMS.txt` para conferir a integridade do download:

```sh
shasum -a 256 -c SHA256SUMS.txt
```

## Stack

- [Tauri v2](https://v2.tauri.app/) (backend Rust) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/)
- [CodeMirror 6](https://codemirror.net/) como engine de edição
- [markdown-it](https://github.com/markdown-it/markdown-it) + [mermaid](https://mermaid.js.org/) + [DOMPurify](https://github.com/cure53/DOMPurify) no pipeline de preview
- [mise](https://mise.jdx.dev/) gerencia as versões de Node e Rust e expõe os comandos do projeto como tasks

## Pré-requisitos

- [mise](https://mise.jdx.dev/getting-started.html) instalado
- No macOS, as Xcode Command Line Tools (exigidas pelo Tauri, não instaladas pelo mise):
  ```sh
  xcode-select --install
  ```

## Como rodar

```sh
mise install   # instala Node e Rust nas versões fixadas em mise.toml
mise run setup # instala dependências npm e do Cargo
mise run dev   # abre o app em modo desenvolvimento com hot reload
```

## Tasks disponíveis

Rode `mise tasks` para a lista completa. As principais:

| Task | O que faz |
|---|---|
| `mise run dev` | Roda o app em modo desenvolvimento |
| `mise run build` | Compila e gera o instalável (`.app`/`.dmg`) |
| `mise run lint` | ESLint no frontend + `cargo clippy` no backend |
| `mise run typecheck` | Verifica os tipos do TypeScript |
| `mise run test` | Testes do frontend (Vitest) e do backend (`cargo test`) |
| `mise run release <versão>` | Prepara o bump de versão numa branch `chore/release-vX.Y.Z` (chamado pela skill `/release`, ver `CLAUDE.md`) |
| `mise run tag` | Fallback manual: cria e envia a tag da versão atual, disparando a release. No fluxo normal isso já acontece sozinho depois do merge do PR de release |

## Onde os arquivos ficam

Por padrão, o scrible lê e grava tanto os arquivos do usuário quanto os dados internos do app (sessão, histórico de versões) em `~/Documents/scrible/`.

## Estrutura do projeto

```
scrible/
├── src-tauri/     # backend Rust (comandos de arquivo, autosave, watcher, menu nativo)
├── src/
│   ├── editor/    # CodeMirror: montagem, autocomplete, decorations de preview inline
│   ├── preview/   # pipeline markdown-it + mermaid + sanitização
│   ├── tabs/       # barra de abas
│   ├── explorer/  # árvore de arquivos
│   ├── theme/     # tokens de tema claro/escuro
│   └── store/     # estado global (Zustand)
└── mise.toml      # versões de ferramentas e tasks do projeto
```

## Contribuindo

O backlog de funcionalidades está nas [issues do repositório](https://github.com/eduardohitek/scrible/issues), organizado nos milestones `v0.1 — MVP` e `v0.2`.
