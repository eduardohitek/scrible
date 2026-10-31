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
 * Endpoints são `<details>` nativos, fechados: funcionam sem JS, inclusive
 * no export (#99). `data-openapi-key` identifica cada um de forma estável
 * entre renders, para o preview manter abertos os que o usuário abriu.
 */

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
export function schemaLabel(schema: SchemaNode | undefined): string {
  if (!schema) return "";
  if (schema.refIssue) return refIssueHtml(schema.refIssue);
  if (schema.ref !== undefined) return `<code class="openapi-schema-ref">${escapeHtml(schema.ref)}</code>`;
  if (schema.items) return `<code>array</code>&lt;${schemaLabel(schema.items)}&gt;`;
  for (const key of ["allOf", "oneOf", "anyOf"] as const) {
    const group = schema[key];
    if (group) return `<code>${key}</code>(${group.map(schemaLabel).join(", ")})`;
  }
  const type = schema.type ?? (schema.properties ? "object" : "");
  if (!type) return "";
  const format = schema.format ? ` <span class="openapi-format">(${escapeHtml(schema.format)})</span>` : "";
  return `<code>${escapeHtml(type)}</code>${format}`;
}

function parametersHtml(parameters: Operation["parameters"]): string {
  if (parameters.length === 0) return "";
  const rows = parameters
    .map((param) => {
      if (isRefIssue(param)) return `<tr><td colspan="5">${refIssueHtml(param)}</td></tr>`;
      return parameterRow(param);
    })
    .join("");
  return `<div class="openapi-section-title">Parâmetros</div>
<table class="openapi-table"><thead><tr><th>Nome</th><th>In</th><th>Tipo</th><th>Obrigatório</th><th>Descrição</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function parameterRow(param: Parameter): string {
  const name = `<code>${escapeHtml(param.name)}</code>${param.deprecated ? ' <span class="openapi-deprecated">obsoleto</span>' : ""}`;
  return `<tr><td>${name}</td><td>${escapeHtml(param.in)}</td><td>${schemaLabel(param.schema)}</td><td>${param.required ? "sim" : "não"}</td><td class="openapi-cell-text">${escapeHtml(param.description ?? "")}</td></tr>`;
}

function contentHtml(content: MediaType[]): string {
  if (content.length === 0) return "";
  const items = content
    .map((media) => {
      const label = schemaLabel(media.schema);
      return `<li><code>${escapeHtml(media.type)}</code>${label ? ` — ${label}` : ""}</li>`;
    })
    .join("");
  return `<ul class="openapi-media">${items}</ul>`;
}

function requestBodyHtml(body: RequestBody | RefIssue | undefined): string {
  if (!body) return "";
  const inner = isRefIssue(body)
    ? `<p>${refIssueHtml(body)}</p>`
    : `${body.required ? '<span class="openapi-required">obrigatório</span>' : ""}${text(body.description, "openapi-description")}${contentHtml(body.content)}`;
  return `<div class="openapi-section-title">Corpo da requisição</div>${inner}`;
}

function responsesHtml(responses: Operation["responses"]): string {
  if (responses.length === 0) return "";
  const rows = responses
    .map((response: Response | RefIssue) => {
      if (isRefIssue(response)) return `<tr><td colspan="3">${refIssueHtml(response)}</td></tr>`;
      return `<tr><td><code class="openapi-status openapi-status-${escapeHtml(response.status.charAt(0))}">${escapeHtml(response.status)}</code></td><td class="openapi-cell-text">${escapeHtml(response.description ?? "")}</td><td>${contentHtml(response.content)}</td></tr>`;
    })
    .join("");
  return `<div class="openapi-section-title">Respostas</div>
<table class="openapi-table"><thead><tr><th>Status</th><th>Descrição</th><th>Conteúdo</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function operationHtml(op: Operation, tag: TagGroup): string {
  const key = `op:${tag.name}:${op.method}:${op.path}`;
  const summary = op.summary ? `<span class="openapi-summary">${escapeHtml(op.summary)}</span>` : "";
  const deprecated = op.deprecated ? '<span class="openapi-deprecated">obsoleto</span>' : "";
  const body =
    text(op.description, "openapi-description") +
    (op.operationId ? `<div class="openapi-operation-id">operationId: <code>${escapeHtml(op.operationId)}</code></div>` : "") +
    parametersHtml(op.parameters) +
    requestBodyHtml(op.requestBody) +
    responsesHtml(op.responses);
  return `<details class="openapi-operation openapi-method-${op.method}" data-openapi-key="${escapeHtml(key)}">
<summary><span class="openapi-method">${op.method.toUpperCase()}</span><code class="openapi-path">${escapeHtml(op.path)}</code>${summary}${deprecated}</summary>
<div class="openapi-operation-body">${body || '<p class="openapi-empty">Sem detalhes.</p>'}</div>
</details>`;
}

function tagHtml(tag: TagGroup): string {
  return `<section class="openapi-tag">
<div class="openapi-tag-name">${escapeHtml(tag.name)}</div>${text(tag.description, "openapi-description")}
${tag.operations.map((op) => operationHtml(op, tag)).join("\n")}
</section>`;
}

export function renderOpenApiHtml(doc: OpenApiDocument): string {
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
    doc.tags.length > 0 ? doc.tags.map(tagHtml).join("\n") : '<p class="openapi-empty">Nenhum endpoint definido.</p>';

  return `<div class="openapi-header">
<div class="openapi-title">${escapeHtml(info.title)}${version}<span class="openapi-badge openapi-badge-muted">OAS ${escapeHtml(doc.openapi)}</span></div>
${text(info.description, "openapi-description")}${servers}
</div>
${tags}`;
}

export function openApiErrorText(error: OpenApiError): string {
  return `Bloco OpenAPI inválido: ${error.message}`;
}
