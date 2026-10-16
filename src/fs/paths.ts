import { isWindows } from "../platform/platform";

/** O frontend monta e compara caminhos sempre com `/` (`lastIndexOf("/")`,
 * `startsWith(`${dir}/`)`…). No Windows o Rust devolve `C:\Users\…`, então todo
 * caminho vindo de fora (`workspace_status`, diálogo de abrir/salvar) passa por
 * aqui na fronteira. O Rust aceita `/` no Windows, então o caminho normalizado
 * volta para ele sem conversão (DECISIONS.md #32). Só converte no Windows: em
 * macOS/Linux `\` é um caractere válido de nome de arquivo. */
export function normalizePath(path: string): string {
  return isWindows() ? path.replace(/\\/g, "/") : path;
}
