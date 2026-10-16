/** O frontend monta e compara caminhos sempre com `/` (`lastIndexOf("/")`,
 * `startsWith(`${dir}/`)`…). No Windows o Rust devolve `C:\Users\…`, então todo
 * caminho vindo de fora (`workspace_status`, diálogo de abrir/salvar) passa por
 * aqui na fronteira. O Rust aceita `/` no Windows, então o caminho normalizado
 * volta para ele sem conversão (DECISIONS.md #32). */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
