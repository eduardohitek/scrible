import MarkdownIt from "markdown-it";
// @ts-expect-error -- markdown-it-footnote não publica tipos
import footnote from "markdown-it-footnote";
// @ts-expect-error -- markdown-it-task-lists não publica tipos
import taskLists from "markdown-it-task-lists";

// Marca cada token de bloco de topo (level 0 — parágrafo, heading,
// blockquote, lista, tabela, fence, hr; exclui tokens aninhados como
// `list_item_open`, level 1) com a linha de origem no markdown, via
// `token.map` (já calculado pelo parser). Regra `core` hand-rolled, mesmo
// padrão de `extractFrontMatter` abaixo: sem plugin de terceiros, sem mutar
// estado de módulo dentro do useMemo de render. `data-source-line` sobrevive
// à sanitização do DOMPurify (ALLOW_DATA_ATTR é true por padrão).
function sourceLinePlugin(mdInstance: InstanceType<typeof MarkdownIt>): void {
  mdInstance.core.ruler.push("source_line_attrs", (state) => {
    for (const token of state.tokens) {
      if (token.map && token.level === 0) {
        token.attrSet("data-source-line", String(token.map[0]));
      }
    }
  });
}

/**
 * Instância compartilhada do pipeline markdown-it (GFM completo, front
 * matter, notas de rodapé) — fonte da verdade única, consumida tanto pelo
 * preview ao vivo (`PreviewPane.tsx`) quanto pelo export standalone (#26).
 */
export const md = new MarkdownIt({ html: false, linkify: true })
  .use(footnote)
  // Checkboxes ficam `disabled` (padrão do plugin): o preview é somente
  // leitura, não há wiring de volta para o documento fonte.
  .use(taskLists)
  .use(sourceLinePlugin);

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ParsedSource {
  frontMatter: string | null;
  body: string;
}

// Extração de front matter feita à mão, sem plugin markdown-it: precisamos
// isolar o bloco `---...---` do corpo *antes* de chamar `md.render()`
// (para renderizá-lo como tabela de metadados, não como markdown), e
// analisá-lo linha a linha (`key: value`) já que só o caso plano é exigido
// pela issue #17. Um plugin markdown-it com callback exigiria mutar uma
// variável de módulo dentro do `useMemo` de render — proibido pela regra de
// pureza do eslint-plugin-react-hooks; extrair fora do pipeline do
// markdown-it evita esse problema por completo.
export function extractFrontMatter(source: string): ParsedSource {
  if (!source.startsWith("---")) return { frontMatter: null, body: source };

  const lines = source.split("\n");
  if (lines[0].trim() !== "---") return { frontMatter: null, body: source };

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) return { frontMatter: null, body: source };

  return {
    frontMatter: lines.slice(1, closingIndex).join("\n"),
    body: lines.slice(closingIndex + 1).join("\n"),
  };
}

function parseFrontMatter(raw: string): Array<[string, string]> {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line): [string, string] | null => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) return null;
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return key ? [key, value] : null;
    })
    .filter((entry): entry is [string, string] => entry !== null);
}

export function renderFrontMatterTable(fm: string): string {
  const entries = parseFrontMatter(fm);
  if (entries.length === 0) return "";
  const rows = entries
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  return `<div class="front-matter"><table class="front-matter-table"><tbody>${rows}</tbody></table></div>`;
}
