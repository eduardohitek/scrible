import { describe, expect, it } from "vitest";
import { DEFAULT_TAG, isRefIssue, parseOpenApi, type OpenApiDocument, type Parameter } from "./parse";

function parseOk(text: string): OpenApiDocument {
  const result = parseOpenApi(text);
  if (!result.ok) throw new Error(`esperava sucesso, veio: ${result.error.message}`);
  return result.doc;
}

const PETSTORE_31 = `
openapi: 3.1.0
info:
  title: Petstore
  version: 1.0.0
  description: Uma loja de pets.
servers:
  - url: https://api.example.com/v1
    description: Produção
tags:
  - name: pets
    description: Tudo sobre pets
paths:
  /pets/{petId}:
    parameters:
      - name: petId
        in: path
        schema:
          type: string
    get:
      tags: [pets]
      summary: Busca um pet
      parameters:
        - $ref: '#/components/parameters/Verbose'
      responses:
        '200':
          description: O pet
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
        default:
          $ref: '#/components/responses/Error'
    post:
      tags: [pets]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Pet'
      responses:
        '201':
          description: Criado
components:
  parameters:
    Verbose:
      name: verbose
      in: query
      schema:
        type: boolean
  responses:
    Error:
      description: Erro inesperado
  schemas:
    Pet:
      type: object
      required: [id]
      properties:
        id:
          type: integer
          format: int64
        tag:
          type: [string, "null"]
`;

describe("parseOpenApi", () => {
  it("aceita YAML 3.1 e normaliza info, servers e operações agrupadas por tag", () => {
    const doc = parseOk(PETSTORE_31);

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toEqual({ title: "Petstore", version: "1.0.0", description: "Uma loja de pets." });
    expect(doc.servers).toEqual([{ url: "https://api.example.com/v1", description: "Produção" }]);
    expect(doc.tags.map((t) => t.name)).toEqual(["pets"]);
    expect(doc.tags[0].description).toBe("Tudo sobre pets");
    expect(doc.tags[0].operations.map((op) => `${op.method} ${op.path}`)).toEqual([
      "get /pets/{petId}",
      "post /pets/{petId}",
    ]);
  });

  it("aceita YAML 3.0 (inclusive `openapi: 3.0` sem aspas)", () => {
    const doc = parseOk("openapi: 3.0\ninfo: {title: X, version: '1'}\npaths: {}\n");
    expect(doc.openapi).toBe("3.0");
    expect(parseOk("openapi: '3.0.3'\ninfo: {title: X, version: '1'}\n").openapi).toBe("3.0.3");
  });

  it("aceita JSON", () => {
    const json = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "JSON API", version: "2" },
      paths: { "/ping": { get: { responses: { "200": { description: "pong" } } } } },
    });
    const doc = parseOk(json);
    expect(doc.info.title).toBe("JSON API");
    expect(doc.tags[0].operations[0].responses).toEqual([{ status: "200", description: "pong", content: [] }]);
  });

  it("devolve erro de sintaxe com a linha", () => {
    const result = parseOpenApi("openapi: 3.1.0\ninfo\n  title: x\nfoo: bar\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("syntax");
    expect(result.error.line).toBe(2);
    expect(result.error.message).toMatch(/^Erro de sintaxe na linha 2: /);
    expect(result.error.message).not.toContain("\n");
  });

  it("recusa Swagger 2.0", () => {
    const result = parseOpenApi('swagger: "2.0"\ninfo: {title: X, version: "1"}\n');
    expect(result).toMatchObject({ ok: false, error: { kind: "unsupported-version" } });
    if (!result.ok) expect(result.error.message).toContain("Swagger 2.0 não suportado");
  });

  it("recusa documento sem `openapi`", () => {
    const result = parseOpenApi("title: só um yaml qualquer\n");
    expect(result).toMatchObject({ ok: false, error: { kind: "not-openapi" } });
    if (!result.ok) expect(result.error.message).toContain("Não parece um documento OpenAPI");
    expect(parseOpenApi("- uma\n- lista\n")).toMatchObject({ ok: false, error: { kind: "not-openapi" } });
    expect(parseOpenApi("")).toMatchObject({ ok: false, error: { kind: "not-openapi" } });
  });

  it("recusa versões fora de 3.0/3.1", () => {
    expect(parseOpenApi("openapi: 4.0.0\n")).toMatchObject({ ok: false, error: { kind: "unsupported-version" } });
  });

  it("resolve $ref interno de parâmetro e de resposta, e mescla parâmetros do path", () => {
    const op = parseOk(PETSTORE_31).tags[0].operations[0];

    const params = op.parameters as Parameter[];
    expect(params.map((p) => `${p.in}:${p.name}:${p.required}`)).toEqual(["path:petId:true", "query:verbose:false"]);
    expect(params[1].schema).toEqual({ type: "boolean" });
    expect(op.responses[1]).toEqual({ status: "default", description: "Erro inesperado", content: [] });
  });

  it("mantém referências a components.schemas como nó nomeado e normaliza o schema", () => {
    const doc = parseOk(PETSTORE_31);
    const [get, post] = doc.tags[0].operations;

    expect(get.responses[0]).toMatchObject({ content: [{ type: "application/json", schema: { ref: "Pet" } }] });
    expect(post.requestBody).toMatchObject({ required: true, content: [{ schema: { ref: "Pet" } }] });
    expect(doc.schemas).toEqual([
      {
        name: "Pet",
        schema: {
          type: "object",
          properties: [
            { name: "id", required: true, schema: { type: "integer", format: "int64" } },
            { name: "tag", required: false, schema: { type: "string | null" } },
          ],
        },
      },
    ]);
  });

  it("marca $ref cíclico em vez de recursar", () => {
    const doc = parseOk(`
openapi: 3.1.0
info: {title: Ciclos, version: '1'}
paths:
  /x:
    get:
      parameters:
        - $ref: '#/components/parameters/A'
      responses:
        '200':
          $ref: '#/components/responses/Loop'
components:
  parameters:
    A: {$ref: '#/components/parameters/B'}
    B: {$ref: '#/components/parameters/A'}
  responses:
    Loop: {$ref: '#/components/responses/Loop'}
  schemas:
    Node:
      type: object
      properties:
        children:
          type: array
          items: {$ref: '#/components/schemas/Node'}
        leaf: {$ref: '#/components/schemas/Leaf'}
    Leaf: {type: string}
    Inline:
      $ref: '#/components/schemas/Inline/properties/self'
      properties:
        self: {$ref: '#/components/schemas/Inline/properties/self'}
`);
    const op = doc.tags[0].operations[0];
    expect(op.parameters).toEqual([{ ref: "#/components/parameters/A", reason: "circular" }]);
    expect(op.responses).toEqual([{ ref: "#/components/responses/Loop", reason: "circular" }]);

    const node = doc.schemas.find((s) => s.name === "Node")!.schema;
    expect(node.properties?.[0].schema.items).toEqual({ ref: "Node", circular: true });
    expect(node.properties?.[1].schema).toEqual({ ref: "Leaf" });

    const inline = doc.schemas.find((s) => s.name === "Inline")!.schema;
    expect(inline.refIssue).toEqual({ ref: "#/components/schemas/Inline/properties/self", reason: "circular" });
  });

  it("não trava com alias YAML que forma ciclo de objetos", () => {
    const doc = parseOk(`
openapi: 3.1.0
info: {title: Alias, version: '1'}
components:
  schemas:
    Loop: &loop
      type: object
      properties:
        self: *loop
`);
    expect(doc.schemas[0].schema.properties?.[0].schema.refIssue?.reason).toBe("circular");
  });

  it("marca $ref inexistente e externo", () => {
    const doc = parseOk(`
openapi: 3.1.0
info: {title: X, version: '1'}
paths:
  /x:
    get:
      parameters:
        - $ref: 'outro.yaml#/components/parameters/A'
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: {$ref: '#/components/schemas/Nope'}
`);
    const op = doc.tags[0].operations[0];
    expect(isRefIssue(op.parameters[0]) && op.parameters[0].reason).toBe("external");
    expect(op.responses[0]).toMatchObject({
      content: [{ schema: { refIssue: { ref: "#/components/schemas/Nope", reason: "missing" } } }],
    });
  });

  it("agrupa operações sem tag em 'default', depois das tags declaradas", () => {
    const doc = parseOk(`
openapi: 3.1.0
info: {title: X, version: '1'}
paths:
  /livre:
    get: {responses: {'200': {description: ok}}}
  /com-tag:
    get: {tags: [a], responses: {'200': {description: ok}}}
`);
    expect(doc.tags.map((t) => t.name)).toEqual(["a", DEFAULT_TAG]);
    expect(doc.tags[1].operations[0].path).toBe("/livre");
  });

  it("ignora path sem operações", () => {
    const doc = parseOk(`
openapi: 3.1.0
info: {title: X, version: '1'}
paths:
  /vazio:
    parameters:
      - {name: id, in: path}
  /nulo:
`);
    expect(doc.tags).toEqual([]);
  });
});
