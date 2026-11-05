import { message } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "../store/documentStore";
import { useTabsStore } from "../store/tabsStore";

const RECREATE = "Recriar";
const QUIT_ANYWAY = "Sair sem recriar";
const CANCEL = "Cancelar";

/** Antes de sair do app (#141): se alguma aba aberta está com o arquivo
 * removido do disco, pergunta se deve recriá-los. Devolve `true` quando pode
 * sair. "Cancelar", fechar o diálogo ou uma recriação que falhe mantêm o app
 * aberto — o conteúdo dessas abas nunca se perde em silêncio. */
export async function confirmQuitWithMissingFiles(): Promise<boolean> {
  const { documents, restoreMissing } = useDocumentStore.getState();
  const missing = useTabsStore.getState().tabs.filter((tab) => documents[tab.id]?.status === "missing");
  if (missing.length === 0) return true;

  const names = missing.map((tab) => `• ${tab.title}`).join("\n");
  const subject =
    missing.length === 1 ? "Um arquivo aberto foi removido do disco" : `${missing.length} arquivos abertos foram removidos do disco`;
  const choice = await message(`${subject}:\n${names}\n\nRecriar antes de sair?`, {
    title: "Arquivos removidos",
    kind: "warning",
    buttons: { yes: RECREATE, no: QUIT_ANYWAY, cancel: CANCEL },
  });

  // Conforme a plataforma, o resultado vem com o texto do botão ou com a chave padrão.
  if (choice === QUIT_ANYWAY || choice === "No") return true;
  if (choice !== RECREATE && choice !== "Yes") return false;

  const failed: string[] = [];
  for (const tab of missing) {
    if (!(await restoreMissing(tab.id))) failed.push(tab.title);
  }
  if (failed.length === 0) return true;

  await message(`Não foi possível recriar:\n${failed.map((name) => `• ${name}`).join("\n")}\n\nUse Salvar Como… para gravar em outro lugar.`, {
    title: "Arquivos removidos",
    kind: "error",
  });
  return false;
}
