import { parseDocument } from "yaml";

/**
 * Parser de blocos ```openapi```/```swagger``` (spec #95, #96): texto YAML ou
 * JSON (JSON é YAML válido, então um único parser cobre os dois) → modelo
 * normalizado pronto para renderizar, ou um erro legível. Módulo puro, sem
 * DOM — o render (#97) consome só o modelo.
 *
 * `$ref` só é resolvido quando é interno (`#/...`). Referências a
 * `#/components/schemas/<Nome>` **não** são expandidas: viram um nó com o
 * nome do schema, que o render transforma em âncora para a seção Schemas
 * (#98). Os demais refs internos (parâmetros, respostas, requestBodies,
 * ponteiros arbitrários) são expandidos no lugar, com detecção de ciclo.
 */

export type OpenApiErrorKind = "syntax" | "unsupported-version" | "not-openapi";

export interface OpenApiError {
  kind: OpenApiErrorKind;
  message: string;
  /** Linha (1-based) do erro de sintaxe YAML, quando houver. */
  line?: number;
}

export type OpenApiParseResult = { ok: true; doc: OpenApiDocument } | { ok: false; error: OpenApiError };

/** Um `$ref` que não pôde virar conteúdo: ciclo, alvo inexistente ou
 * externo (outro arquivo/URL, fora de escopo da spec). */
export interface RefIssue {
  ref: string;
  reason: "circular" | "missing" | "external";
}

export interface SchemaProperty {
  name: string;
  required: boolean;
  schema: SchemaNode;
}

export interface SchemaNode {
  /** Nome em `#/components/schemas/<Nome>` quando o nó é uma referência a ele. */
  ref?: string;
  /** A referência nomeada faz parte de um ciclo entre schemas. */
  circular?: boolean;
  refIssue?: RefIssue;
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  nullable?: boolean;
  properties?: SchemaProperty[];
  items?: SchemaNode;
  additionalProperties?: SchemaNode;
  allOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  anyOf?: SchemaNode[];
}

export interface Parameter {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  deprecated: boolean;
  schema?: SchemaNode;
}

export interface MediaType {
  type: string;
  schema?: SchemaNode;
}

export interface RequestBody {
  description?: string;
  required: boolean;
  content: MediaType[];
}

export interface Response {
  status: string;
  description?: string;
  content: MediaType[];
}

export const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface Operation {
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  deprecated: boolean;
  parameters: Array<Parameter | RefIssue>;
  requestBody?: RequestBody | RefIssue;
  responses: Array<Response | RefIssue>;
}

export interface TagGroup {
  name: string;
  description?: string;
  operations: Operation[];
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers: Array<{ url: string; description?: string }>;
  tags: TagGroup[];
  schemas: Array<{ name: string; schema: SchemaNode }>;
}

export const DEFAULT_TAG = "default";

type Json = Record<string, unknown>;

const SCHEMA_REF_PREFIX = "#/components/schemas/";

export function isRefIssue(value: unknown): value is RefIssue {
  return isObject(value) && typeof value.ref === "string" && typeof value.reason === "string";
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function parseOpenApi(text: string): OpenApiParseResult {
  const yamlDoc = parseDocument(text);
  if (yamlDoc.errors.length > 0) {
    const err = yamlDoc.errors[0];
    const line = err.linePos?.[0].line;
    // A mensagem do `yaml` traz "... at line N, column M:" + um trecho do
    // código; a linha já vai à parte, então só a primeira frase interessa.
    const reason = err.message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "");
    return {
      ok: false,
      error: {
        kind: "syntax",
        line,
        message: line !== undefined ? `Erro de sintaxe na linha ${line}: ${reason}` : `Erro de sintaxe: ${reason}`,
      },
    };
  }

  let root: unknown;
  try {
    root = yamlDoc.toJS({ maxAliasCount: 100 });
  } catch (err) {
    return {
      ok: false,
      error: { kind: "syntax", message: `Erro de sintaxe: ${err instanceof Error ? err.message : String(err)}` },
    };
  }

  if (!isObject(root)) {
    return { ok: false, error: { kind: "not-openapi", message: "Não parece um documento OpenAPI." } };
  }
  if (root.swagger !== undefined && root.openapi === undefined) {
    return {
      ok: false,
      error: {
        kind: "unsupported-version",
        message: "Swagger 2.0 não suportado — converta o documento para OpenAPI 3.0 ou 3.1.",
      },
    };
  }
  if (root.openapi === undefined) {
    return {
      ok: false,
      error: { kind: "not-openapi", message: "Não parece um documento OpenAPI (campo `openapi` ausente)." },
    };
  }

  const version = normalizeVersion(root.openapi);
  if (!/^3\.[01](\.\d+)?(-.+)?$/.test(version)) {
    return {
      ok: false,
      error: {
        kind: "unsupported-version",
        message: `OpenAPI ${version} não suportado — só as versões 3.0 e 3.1.`,
      },
    };
  }

  return { ok: true, doc: new Normalizer(root).document(version) };
}

// `openapi: 3.0` sem aspas vira o número 3 no YAML.
function normalizeVersion(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? `${value}.0` : String(value);
  return str(value) ?? "";
}

class Normalizer {
  private readonly componentSchemas: Json;
  private readonly schemaCycleCache = new Map<string, Set<string>>();

  constructor(private readonly root: Json) {
    const components = isObject(root.components) ? root.components : {};
    this.componentSchemas = isObject(components.schemas) ? components.schemas : {};
  }

  document(version: string): OpenApiDocument {
    const info = isObject(this.root.info) ? this.root.info : {};
    return {
      openapi: version,
      info: {
        title: str(info.title) ?? "API sem título",
        version: str(info.version) ?? "",
        description: str(info.description),
      },
      servers: (Array.isArray(this.root.servers) ? this.root.servers : [])
        .filter(isObject)
        .map((server) => ({ url: str(server.url) ?? "", description: str(server.description) })),
      tags: this.tagGroups(),
      schemas: Object.keys(this.componentSchemas).map((name) => ({
        name,
        schema: this.schema(this.componentSchemas[name], [], new Set(), name),
      })),
    };
  }

  /** Resolve um ponteiro JSON interno (`#/a/b~1c`). */
  private pointer(ref: string): unknown {
    const parts = ref.slice(2).split("/").filter((part) => part !== "");
    let current: unknown = this.root;
    for (const raw of parts) {
      const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
      if (Array.isArray(current)) current = current[Number(key)];
      else if (isObject(current)) current = current[key];
      else return undefined;
    }
    return current;
  }

  /** Segue uma cadeia de `$ref` (não-schema) até um objeto concreto. `stack`
   * são os refs já em expansão no caminho atual — reencontrar um deles é um
   * ciclo, que vira um `RefIssue` em vez de recursão infinita. */
  private deref(value: unknown, stack: string[]): { value: Json; stack: string[] } | RefIssue {
    let current = value;
    let path = stack;
    while (isObject(current) && typeof current.$ref === "string") {
      const ref = current.$ref;
      if (!ref.startsWith("#")) return { ref, reason: "external" };
      if (path.includes(ref)) return { ref, reason: "circular" };
      path = [...path, ref];
      current = this.pointer(ref);
      if (current === undefined) return { ref, reason: "missing" };
    }
    return { value: isObject(current) ? current : {}, stack: path };
  }

  private tagGroups(): TagGroup[] {
    const declared = (Array.isArray(this.root.tags) ? this.root.tags : []).filter(isObject);
    const groups = new Map<string, TagGroup>();
    for (const tag of declared) {
      const name = str(tag.name);
      if (name && !groups.has(name)) groups.set(name, { name, description: str(tag.description), operations: [] });
    }

    const paths = isObject(this.root.paths) ? this.root.paths : {};
    const untagged: Operation[] = [];
    for (const path of Object.keys(paths)) {
      const item = this.deref(paths[path], []);
      if (isRefIssue(item)) continue;
      const pathParams = Array.isArray(item.value.parameters) ? item.value.parameters : [];

      for (const method of HTTP_METHODS) {
        const raw = item.value[method];
        if (!isObject(raw)) continue;
        const operation = this.operation(method, path, raw, pathParams, item.stack);
        const tags = (Array.isArray(raw.tags) ? raw.tags : []).map(str).filter((t): t is string => !!t);
        if (tags.length === 0) untagged.push(operation);
        for (const tag of tags) {
          if (!groups.has(tag)) groups.set(tag, { name: tag, operations: [] });
          groups.get(tag)!.operations.push(operation);
        }
      }
    }

    if (untagged.length > 0) {
      const fallback = groups.get(DEFAULT_TAG) ?? { name: DEFAULT_TAG, operations: [] };
      fallback.operations.push(...untagged);
      groups.delete(DEFAULT_TAG);
      groups.set(DEFAULT_TAG, fallback);
    }
    return [...groups.values()].filter((group) => group.operations.length > 0);
  }

  private operation(method: HttpMethod, path: string, raw: Json, pathParams: unknown[], stack: string[]): Operation {
    // Parâmetros do path item valem para todas as operações; um parâmetro da
    // operação com o mesmo `name`+`in` sobrescreve o do path.
    const merged = new Map<string, Parameter | RefIssue>();
    const opParams = Array.isArray(raw.parameters) ? raw.parameters : [];
    for (const entry of [...pathParams, ...opParams]) {
      const param = this.parameter(entry, stack);
      merged.set(isRefIssue(param) ? `ref:${param.ref}` : `${param.in}:${param.name}`, param);
    }

    const responses = isObject(raw.responses) ? raw.responses : {};
    return {
      method,
      path,
      summary: str(raw.summary),
      description: str(raw.description),
      operationId: str(raw.operationId),
      deprecated: raw.deprecated === true,
      parameters: [...merged.values()],
      requestBody: raw.requestBody === undefined ? undefined : this.requestBody(raw.requestBody, stack),
      responses: Object.keys(responses).map((status) => this.response(status, responses[status], stack)),
    };
  }

  private parameter(raw: unknown, stack: string[]): Parameter | RefIssue {
    const resolved = this.deref(raw, stack);
    if (isRefIssue(resolved)) return resolved;
    const param = resolved.value;
    const location = str(param.in) ?? "";
    return {
      name: str(param.name) ?? "",
      in: location,
      required: param.required === true || location === "path",
      description: str(param.description),
      deprecated: param.deprecated === true,
      schema: param.schema === undefined ? undefined : this.schema(param.schema, resolved.stack, new Set()),
    };
  }

  private requestBody(raw: unknown, stack: string[]): RequestBody | RefIssue {
    const resolved = this.deref(raw, stack);
    if (isRefIssue(resolved)) return resolved;
    return {
      description: str(resolved.value.description),
      required: resolved.value.required === true,
      content: this.content(resolved.value.content, resolved.stack),
    };
  }

  private response(status: string, raw: unknown, stack: string[]): Response | RefIssue {
    const resolved = this.deref(raw, stack);
    if (isRefIssue(resolved)) return resolved;
    return {
      status,
      description: str(resolved.value.description),
      content: this.content(resolved.value.content, resolved.stack),
    };
  }

  private content(raw: unknown, stack: string[]): MediaType[] {
    if (!isObject(raw)) return [];
    return Object.keys(raw).map((type) => {
      const media = isObject(raw[type]) ? (raw[type] as Json) : {};
      return {
        type,
        schema: media.schema === undefined ? undefined : this.schema(media.schema, stack, new Set()),
      };
    });
  }

  /**
   * Normaliza um schema. `stack` são os refs não-nomeados em expansão;
   * `seen` são os objetos já no caminho atual — aliases YAML (`&a`/`*a`)
   * podem formar um ciclo de objetos de verdade, sem nenhum `$ref`.
   * `owner` é o schema de `components.schemas` sendo descrito, usado para
   * marcar referências que voltam a ele.
   */
  private schema(raw: unknown, stack: string[], seen: Set<object>, owner?: string): SchemaNode {
    if (isObject(raw) && typeof raw.$ref === "string") {
      const ref = raw.$ref;
      if (ref.startsWith(SCHEMA_REF_PREFIX) && !ref.slice(SCHEMA_REF_PREFIX.length).includes("/")) {
        const name = decodeURIComponent(ref.slice(SCHEMA_REF_PREFIX.length)).replace(/~1/g, "/").replace(/~0/g, "~");
        if (!(name in this.componentSchemas)) return { refIssue: { ref, reason: "missing" } };
        const node: SchemaNode = { ref: name };
        if (owner !== undefined && this.reachableSchemas(name).has(owner)) node.circular = true;
        return node;
      }
      const resolved = this.deref(raw, stack);
      if (isRefIssue(resolved)) return { refIssue: resolved };
      return this.schema(resolved.value, resolved.stack, seen, owner);
    }
    if (!isObject(raw)) return {};
    if (seen.has(raw)) return { refIssue: { ref: "(alias YAML)", reason: "circular" } };
    const path = new Set(seen).add(raw);
    const child = (value: unknown) => this.schema(value, stack, path, owner);
    const list = (value: unknown) => (Array.isArray(value) ? value.map(child) : undefined);

    const node: SchemaNode = {};
    // 3.1: `type` pode ser lista (`[string, "null"]`).
    const type = Array.isArray(raw.type) ? raw.type.map(str).filter(Boolean).join(" | ") : str(raw.type);
    if (type) node.type = type;
    if (str(raw.format)) node.format = str(raw.format);
    if (str(raw.description)) node.description = str(raw.description);
    if (Array.isArray(raw.enum)) node.enum = raw.enum.map((value) => (value === null ? "null" : String(value)));
    if (raw.nullable === true) node.nullable = true;

    if (isObject(raw.properties)) {
      const required = new Set((Array.isArray(raw.required) ? raw.required : []).map(str));
      const props = raw.properties;
      node.properties = Object.keys(props).map((name) => ({
        name,
        required: required.has(name),
        schema: child(props[name]),
      }));
    }
    if (raw.items !== undefined) node.items = child(raw.items);
    if (isObject(raw.additionalProperties)) node.additionalProperties = child(raw.additionalProperties);
    for (const key of ["allOf", "oneOf", "anyOf"] as const) {
      const group = list(raw[key]);
      if (group) node[key] = group;
    }
    return node;
  }

  /** Nomes de `components.schemas` alcançáveis a partir de `name` seguindo
   * refs nomeados (inclusive o próprio, se houver ciclo). Memoizado. */
  private reachableSchemas(name: string): Set<string> {
    const cached = this.schemaCycleCache.get(name);
    if (cached) return cached;
    const reached = new Set<string>();
    const queue = [name];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of directSchemaRefs(this.componentSchemas[current])) {
        if (next in this.componentSchemas && !reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    this.schemaCycleCache.set(name, reached);
    return reached;
  }
}

/** Nomes referenciados (`#/components/schemas/X`) em qualquer profundidade de
 * um schema cru, sem atravessar outros schemas nomeados. */
function directSchemaRefs(raw: unknown): Set<string> {
  const names = new Set<string>();
  const seen = new Set<object>();
  const walk = (value: unknown) => {
    if (typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const obj = value as Json;
    if (typeof obj.$ref === "string" && obj.$ref.startsWith(SCHEMA_REF_PREFIX)) {
      names.add(obj.$ref.slice(SCHEMA_REF_PREFIX.length).split("/")[0]);
      return;
    }
    Object.values(obj).forEach(walk);
  };
  walk(raw);
  return names;
}
