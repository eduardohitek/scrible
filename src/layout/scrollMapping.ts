// Mapeamento de posição entre o editor (linhas de origem, 0-indexadas — a
// mesma unidade de `token.map` do markdown-it) e o preview (offset em pixels
// dentro do seu próprio container de scroll). Funções puras, sem I/O: quem
// monta `anchors` (ver `useScrollSync.ts`) é responsável por consultar o DOM
// ao vivo a cada evento de scroll, não cachear entre renders.

export interface LineAnchor {
  line: number;
  top: number;
}

/**
 * Interpola linearmente entre as duas âncoras que cercam `line`,
 * devolvendo o `top` correspondente. `anchors` deve vir ordenado por `line`
 * crescente e incluir âncoras sintéticas de início/fim para que os extremos
 * do documento também interpolem (ver `useScrollSync.ts`).
 */
export function lineToOffset(anchors: LineAnchor[], line: number): number {
  return interpolate(anchors, line, (a) => a.line, (a) => a.top);
}

/** Inverso de `lineToOffset`: dado um offset em pixels, devolve a linha correspondente. */
export function offsetToLine(anchors: LineAnchor[], offset: number): number {
  return interpolate(anchors, offset, (a) => a.top, (a) => a.line);
}

function interpolate(
  anchors: LineAnchor[],
  query: number,
  key: (a: LineAnchor) => number,
  value: (a: LineAnchor) => number,
): number {
  if (anchors.length === 0) return 0;
  if (anchors.length === 1) return value(anchors[0]);

  let lower = anchors[0];
  let upper = anchors[anchors.length - 1];

  if (query <= key(lower)) {
    // Extrapola usando o par inicial de âncoras.
    upper = anchors[1];
  } else if (query >= key(upper)) {
    // Extrapola usando o par final de âncoras.
    lower = anchors[anchors.length - 2];
  } else {
    for (let i = 0; i < anchors.length - 1; i++) {
      if (key(anchors[i]) <= query && query <= key(anchors[i + 1])) {
        lower = anchors[i];
        upper = anchors[i + 1];
        break;
      }
    }
  }

  const keySpan = key(upper) - key(lower);
  if (keySpan === 0) return value(lower);

  const fraction = (query - key(lower)) / keySpan;
  return value(lower) + fraction * (value(upper) - value(lower));
}
