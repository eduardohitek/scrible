// jsdom não implementa getBBox/getComputedTextLength (medição de layout
// SVG), que o mermaid usa para posicionar nós/texto nos diagramas — sem
// esses stubs, mermaid.render() lança exceção pra QUALQUER diagrama (válido
// ou não) rodando sob jsdom, o que tornaria impossível testar o caminho de
// sucesso do preview (#18).
//
// Os stubs vão em `SVGElement.prototype`, não `SVGGraphicsElement`/
// `SVGTextContentElement` (os donos "corretos" desses métodos pela spec):
// jsdom instancia elementos SVG sem interface dedicada (ex: <text>, <g>)
// genericamente como `SVGElement`, não como subclasses especializadas —
// confirmado lendo a cadeia de protótipos de um <text> real em jsdom.
type SvgMeasurable = SVGElement & {
  getBBox(): DOMRect;
  getComputedTextLength(): number;
};

(SVGElement.prototype as SvgMeasurable).getBBox = () =>
  ({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    top: 0,
    right: 100,
    bottom: 20,
    left: 0,
    toJSON() {
      return this;
    },
  }) as DOMRect;

(SVGElement.prototype as SvgMeasurable).getComputedTextLength = () => 50;

// jsdom implementa `Element.prototype.getClientRects`/`getBoundingClientRect`
// (retornam retângulos vazios, sem lançar), mas não implementa
// `Range.prototype.getClientRects` — usado pelo próprio CodeMirror
// (`@codemirror/view`) para medir a posição de texto na tela (linhas,
// tooltips de busca/autocomplete). Sem o stub, qualquer teste que deixe uma
// `EditorView` real rodar um ciclo de medição (`requestMeasure`) sob jsdom
// lança `getClientRects is not a function` de dentro de um `requestAnimationFrame`
// — mesma categoria de lacuna de API de layout do jsdom já registrada para
// SVG na `#18`, agora para `Range` (`#15`).
(Range.prototype as Range & { getClientRects(): DOMRectList }).getClientRects = () => [] as unknown as DOMRectList;
