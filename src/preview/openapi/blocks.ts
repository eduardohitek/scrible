import { parseOpenApi } from "./parse";
import { openApiErrorText, renderOpenApiHtml } from "./render";

const OPENAPI_BLOCK_SELECTOR = "pre > code.language-openapi, pre > code.language-swagger";

export interface RenderOpenApiOptions {
  /** `data-openapi-key` dos `<details>` que devem sair abertos. */
  openKeys?: ReadonlySet<string>;
}

/**
 * Troca cada ```openapi```/```swagger``` de `container` (HTML já sanitizado)
 * pela documentação renderizada, ou por um `.openapi-error` isolado para
 * aquele bloco. Síncrono — ao contrário do mermaid, não há render
 * assíncrono. Compartilhado entre o preview ao vivo e o export (#99).
 */
export function renderOpenApiBlocks(container: HTMLElement, options: RenderOpenApiOptions = {}): void {
  container.querySelectorAll<HTMLElement>(OPENAPI_BLOCK_SELECTOR).forEach((block, index) => {
    const pre = block.parentElement!;
    // `data-source-line` (#20) vive no <code>; o elemento novo herda pra não
    // perder a âncora do scroll sync (mesmo cuidado do mermaid).
    const sourceLine = block.dataset.sourceLine;
    const result = parseOpenApi(block.textContent ?? "");

    const element = document.createElement("div");
    if (result.ok) {
      element.className = "openapi";
      element.innerHTML = renderOpenApiHtml(result.doc);
      // Prefixo por bloco: dois blocos no mesmo documento podem ter
      // operações iguais.
      element.querySelectorAll<HTMLDetailsElement>("details[data-openapi-key]").forEach((details) => {
        details.dataset.openapiKey = `${index}:${details.dataset.openapiKey}`;
        if (options.openKeys?.has(details.dataset.openapiKey)) details.open = true;
      });
    } else {
      element.className = "openapi-error";
      element.textContent = openApiErrorText(result.error);
    }
    if (sourceLine !== undefined) element.dataset.sourceLine = sourceLine;
    pre.replaceWith(element);
  });
}

/** Chaves dos `<details>` OpenAPI abertos agora em `container` — lidas antes
 * de o preview reescrever o `innerHTML`, para reabri-los no render seguinte. */
export function collectOpenOpenApiKeys(container: HTMLElement): Set<string> {
  return new Set(
    Array.from(container.querySelectorAll<HTMLDetailsElement>("details[data-openapi-key][open]"), (details) =>
      details.dataset.openapiKey!,
    ),
  );
}
