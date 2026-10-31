import { escapeHtml } from "../markdownPipeline";
import {
  isRefIssue,
  type MediaType,
  type OpenApiDocument,
  type OpenApiError,
  type Operation,
  type Parameter,
  type RefIssue,
  type RequestBody,
  type Response,
  type SchemaNode,
  type TagGroup,
} from "./parse";

/**
 * Render do modelo de `parse.ts` como HTML estático (#97). A string é
 * injetada **depois** do DOMPurify do preview, então todo texto vindo do
 * documento passa por `escapeHtml` — nada do documento vira HTML cru.
 * `description` fica como texto puro (quebras preservadas via CSS), sem
 * markdown nesta entrega.
 *
 * Endpoints e schemas são `<details>` nativos, fechados: funcionam sem JS,
 * inclusive no export (#99). `data-openapi-key` identifica cada um de forma
 * estável entre renders, para o preview manter abertos os que o usuário
 * abriu.
 */

/** `idPrefix` torna únicas as âncoras de schema (#98) quando o documento tem
 * mais de um bloco OpenAPI. */
export interface RenderContext {
  idPrefix: string;
}

export function schemaAnchorId(name: string, ctx: RenderContext): string {
  return `${ctx.idPrefix}schema-${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

const REF_REASON_LABEL: Record<RefIssue["reason"], string> = {
  circular: "referência cíclica",
  missing: "referência não encontrada",
  external: "referência externa não suportada",
};

function text(value: string | undefined, className: string): string {
  return value ? `<div class="${className}">${escapeHtml(value)}</div>` : "";
}

function refIssueHtml(issue: RefIssue): string {
  return `<span class="openapi-ref-issue">${REF_REASON_LABEL[issue.reason]}: <code>${escapeHtml(issue.ref)}</code></span>`;
}

/** Rótulo curto de um schema para tabelas (ex.: `Pet`, `array<Pet>`,
 * `string (date-time)`). */
export function schemaLabel(schema: SchemaNode | undefined, ctx: RenderContext): string {
  if (!schema) return "";
  if (schema.refIssue) return refIssueHtml(schema.refIssue);
  if (schema.ref !== undefined) {
    // Referência a components.schemas vira âncora para a seção Schemas
    // (#98); não expande de novo — um ciclo nunca recursa no render.
    const circular = schema.circular
      ? ' <span class="openapi-circular" title="Referência cíclica">↻ cíclico</span>'
      : "";
    return `<a class="openapi-schema-ref" href="#${schemaAnchorId(schema.ref, ctx)}">${escapeHtml(schema.ref)}</a>${circular}`;
  }
  if (schema.items) return `<code>array</code>&lt;${schemaLabel(schema.items, ctx)}&gt;`;
  for (const key of ["allOf", "oneOf", "anyOf"] as const) {
    const group = schema[key];
    if (group) return `<code>${key}</code>(${group.map((member) => schemaLabel(member, ctx)).join(", ")})`;
  }
  const type = schema.type ?? (schema.properties ? "object" : "");
  if (!type) return "";
  const format = schema.format ? ` <span class="openapi-format">(${escapeHtml(schema.format)})</span>` : "";
  return `<code>${escapeHtml(type)}</code>${format}`;
}

function parametersHtml(parameters: Operation["parameters"], ctx: RenderContext): string {
  if (parameters.length === 0) return "";
  const rows = parameters
    .map((param) => {
      if (isRefIssue(param)) return `<tr><td colspan="5">${refIssueHtml(param)}</td></tr>`;
      return parameterRow(param, ctx);
    })
    .join("");
  return `<div class="openapi-section-title">Parâmetros</div>
<table class="openapi-table"><thead><tr><th>Nome</th><th>In</th><th>Tipo</th><th>Obrigatório</th><th>Descrição</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function parameterRow(param: Parameter, ctx: RenderContext): string {
  const name = `<code>${escapeHtml(param.name)}</code>${param.deprecated ? ' <span class="openapi-deprecated">obsoleto</span>' : ""}`;
  return `<tr><td>${name}</td><td>${escapeHtml(param.in)}</td><td>${schemaLabel(param.schema, ctx)}</td><td>${param.required ? "sim" : "não"}</td><td class="openapi-cell-text">${escapeHtml(param.description ?? "")}</td></tr>`;
}

function contentHtml(content: MediaType[], ctx: RenderContext): string {
  if (content.length === 0) return "";
  const items = content
    .map((media) => {
      const label = schemaLabel(media.schema, ctx);
      return `<li><code>${escapeHtml(media.type)}</code>${label ? ` — ${label}` : ""}</li>`;
    })
    .join("");
  return `<ul class="openapi-media">${items}</ul>`;
}

function requestBodyHtml(body: RequestBody | RefIssue | undefined, ctx: RenderContext): string {
  if (!body) return "";
  const inner = isRefIssue(body)
    ? `<p>${refIssueHtml(body)}</p>`
    : `${body.required ? '<span class="openapi-required">obrigatório</span>' : ""}${text(body.description, "openapi-description")}${contentHtml(body.content, ctx)}`;
  return `<div class="openapi-section-title">Corpo da requisição</div>${inner}`;
}

function responsesHtml(responses: Operation["responses"], ctx: RenderContext): string {
  if (responses.length === 0) return "";
  const rows = responses
    .map((response: Response | RefIssue) => {
      if (isRefIssue(response)) return `<tr><td colspan="3">${refIssueHtml(response)}</td></tr>`;
      return `<tr><td><code class="openapi-status openapi-status-${escapeHtml(response.status.charAt(0))}">${escapeHtml(response.status)}</code></td><td class="openapi-cell-text">${escapeHtml(response.description ?? "")}</td><td>${contentHtml(response.content, ctx)}</td></tr>`;
    })
    .join("");
  return `<div class="openapi-section-title">Respostas</div>
<table class="openapi-table"><thead><tr><th>Status</th><th>Descrição</th><th>Conteúdo</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function operationHtml(op: Operation, tag: TagGroup, ctx: RenderContext): string {
  const key = `op:${tag.name}:${op.method}:${op.path}`;
  const summary = op.summary ? `<span class="openapi-summary">${escapeHtml(op.summary)}</span>` : "";
  const deprecated = op.deprecated ? '<span class="openapi-deprecated">obsoleto</span>' : "";
  const body =
    text(op.description, "openapi-description") +
    (op.operationId ? `<div class="openapi-operation-id">operationId: <code>${escapeHtml(op.operationId)}</code></div>` : "") +
    parametersHtml(op.parameters, ctx) +
    requestBodyHtml(op.requestBody, ctx) +
    responsesHtml(op.responses, ctx);
  return `<details class="openapi-operation openapi-method-${op.method}" data-openapi-key="${escapeHtml(key)}">
<summary><span class="openapi-method">${op.method.toUpperCase()}</span><code class="openapi-path">${escapeHtml(op.path)}</code>${summary}${deprecated}</summary>
<div class="openapi-operation-body">${body || '<p class="openapi-empty">Sem detalhes.</p>'}</div>
</details>`;
}

function tagHtml(tag: TagGroup, ctx: RenderContext): string {
  return `<section class="openapi-tag">
<div class="openapi-tag-name">${escapeHtml(tag.name)}</div>${text(tag.description, "openapi-description")}
${tag.operations.map((op) => operationHtml(op, tag, ctx)).join("\n")}
</section>`;
}

const COMPOSITION_LABEL = { allOf: "todos de (allOf)", oneOf: "um de (oneOf)", anyOf: "algum de (anyOf)" };

/** O nó tem algo a mostrar além do rótulo — só esses viram `<details>`
 * expansível na árvore. Refs nunca têm: são links. */
function hasChildren(node: SchemaNode): boolean {
  if (node.ref !== undefined || node.refIssue) return false;
  return !!(
    node.properties?.length ||
    node.allOf ||
    node.oneOf ||
    node.anyOf ||
    (node.additionalProperties && hasChildren(node.additionalProperties)) ||
    (node.items && hasChildren(node.items))
  );
}

function enumHtml(node: SchemaNode): string {
  if (!node.enum) return "";
  return `<span class="openapi-enum">enum: ${node.enum.map((value) => `<code>${escapeHtml(value)}</code>`).join(", ")}</span>`;
}

/** Linha de um item da árvore: nome (quando há), tipo, marcadores e
 * descrição. */
function schemaLine(name: string | undefined, required: boolean, node: SchemaNode, ctx: RenderContext): string {
  return [
    name !== undefined ? `<code class="openapi-prop-name">${escapeHtml(name)}</code>` : "",
    schemaLabel(node, ctx),
    required ? '<span class="openapi-required">obrigatório</span>' : "",
    node.nullable ? '<span class="openapi-format">nullable</span>' : "",
    enumHtml(node),
    node.description ? `<span class="openapi-prop-description">${escapeHtml(node.description)}</span>` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Item da árvore: `<details>` quando tem filhos (objeto aninhado, array de
 * objetos, composição), senão uma linha simples. */
function schemaItemHtml(
  name: string | undefined,
  required: boolean,
  node: SchemaNode,
  key: string,
  ctx: RenderContext,
): string {
  const line = schemaLine(name, required, node, ctx);
  if (!hasChildren(node)) return `<li class="openapi-prop">${line}</li>`;
  return `<li class="openapi-prop"><details class="openapi-prop-details" data-openapi-key="${escapeHtml(key)}"><summary>${line}</summary>${schemaChildrenHtml(node, key, ctx)}</details></li>`;
}

function schemaChildrenHtml(node: SchemaNode, key: string, ctx: RenderContext): string {
  const parts: string[] = [];
  if (node.properties?.length) {
    parts.push(
      `<ul class="openapi-props">${node.properties
        .map((prop) => schemaItemHtml(prop.name, prop.required, prop.schema, `${key}/${prop.name}`, ctx))
        .join("")}</ul>`,
    );
  }
  if (node.items && hasChildren(node.items)) {
    parts.push(groupHtml("itens", [node.items], `${key}/items`, ctx));
  }
  if (node.additionalProperties && hasChildren(node.additionalProperties)) {
    parts.push(groupHtml("propriedades adicionais", [node.additionalProperties], `${key}/additional`, ctx));
  }
  for (const group of ["allOf", "oneOf", "anyOf"] as const) {
    const members = node[group];
    if (members) parts.push(groupHtml(COMPOSITION_LABEL[group], members, `${key}/${group}`, ctx));
  }
  return `<div class="openapi-schema-children">${parts.join("")}</div>`;
}

function groupHtml(label: string, members: SchemaNode[], key: string, ctx: RenderContext): string {
  const items = members.map((member, index) => schemaItemHtml(undefined, false, member, `${key}/${index}`, ctx)).join("");
  return `<div class="openapi-schema-group"><div class="openapi-group-label">${escapeHtml(label)}</div><ul class="openapi-props">${items}</ul></div>`;
}

function schemasHtml(schemas: OpenApiDocument["schemas"], ctx: RenderContext): string {
  if (schemas.length === 0) return "";
  const items = schemas
    .map(({ name, schema }) => {
      const key = `schema:${name}`;
      const label = schemaLabel(schema, ctx);
      const description = schema.description ? `<div class="openapi-description">${escapeHtml(schema.description)}</div>` : "";
      const enumLine = schema.enum ? `<div>${enumHtml(schema)}</div>` : "";
      const children = hasChildren(schema) ? schemaChildrenHtml(schema, key, ctx) : "";
      return `<details class="openapi-schema" id="${schemaAnchorId(name, ctx)}" data-openapi-key="${escapeHtml(key)}">
<summary><code class="openapi-schema-name">${escapeHtml(name)}</code>${label ? ` ${label}` : ""}</summary>
<div class="openapi-operation-body">${description}${enumLine}${children || (description || enumLine ? "" : '<p class="openapi-empty">Sem propriedades.</p>')}</div>
</details>`;
    })
    .join("\n");
  return `<section class="openapi-tag openapi-schemas">
<div class="openapi-tag-name">Schemas</div>
${items}
</section>`;
}

export function renderOpenApiHtml(doc: OpenApiDocument, ctx: RenderContext = { idPrefix: "openapi-" }): string {
  const { info } = doc;
  const version = info.version ? `<span class="openapi-badge">${escapeHtml(info.version)}</span>` : "";
  const servers =
    doc.servers.length > 0
      ? `<ul class="openapi-servers">${doc.servers
          .map(
            (server) =>
              `<li><code>${escapeHtml(server.url)}</code>${server.description ? ` — ${escapeHtml(server.description)}` : ""}</li>`,
          )
          .join("")}</ul>`
      : "";
  const tags =
    doc.tags.length > 0
      ? doc.tags.map((tag) => tagHtml(tag, ctx)).join("\n")
      : '<p class="openapi-empty">Nenhum endpoint definido.</p>';

  return `<div class="openapi-header">
<div class="openapi-title">${escapeHtml(info.title)}${version}<span class="openapi-badge openapi-badge-muted">OAS ${escapeHtml(doc.openapi)}</span></div>
${text(info.description, "openapi-description")}${servers}
</div>
${tags}
${schemasHtml(doc.schemas, ctx)}`;
}

export function openApiErrorText(error: OpenApiError): string {
  return `Bloco OpenAPI inválido: ${error.message}`;
}
