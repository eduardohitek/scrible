import { openUrl } from "@tauri-apps/plugin-opener";
import { useUpdateStore } from "./updateStore";

const RELEASES_URL = "https://github.com/eduardohitek/scrible/releases";

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Faixa não-modal no topo, mesmo padrão do `ConflictBanner` (#10): avisa
 * sem interromper a escrita. Some sozinha quando `status === "hidden"`. */
export function UpdateBanner() {
  const status = useUpdateStore((state) => state.status);
  const version = useUpdateStore((state) => state.version);
  const downloaded = useUpdateStore((state) => state.downloaded);
  const total = useUpdateStore((state) => state.total);
  const error = useUpdateStore((state) => state.error);
  const install = useUpdateStore((state) => state.install);
  const dismiss = useUpdateStore((state) => state.dismiss);
  const skip = useUpdateStore((state) => state.skip);

  if (status === "hidden") return null;

  return (
    <div className="update-banner" role="status">
      {status === "checking" && <span>Procurando atualizações…</span>}

      {status === "upToDate" && <span>Você já está na versão mais recente.</span>}

      {status === "error" && <span>Não foi possível atualizar: {error}</span>}

      {status === "available" && version && (
        <span>
          A versão {version} do scrible está disponível.{" "}
          <button
            type="button"
            className="update-banner-link"
            onClick={() => void openUrl(`${RELEASES_URL}/tag/v${version}`)}
          >
            Ver novidades
          </button>
        </span>
      )}

      {status === "downloading" && (
        <span>
          Baixando a versão {version}…{" "}
          {total ? `${Math.min(100, Math.round((downloaded / total) * 100))}%` : formatMegabytes(downloaded)}
        </span>
      )}

      <div className="update-banner-actions">
        {status === "available" && (
          <>
            <button type="button" onClick={() => void install()}>
              Atualizar e reiniciar
            </button>
            <button type="button" onClick={dismiss}>
              Depois
            </button>
            <button type="button" onClick={() => void skip()}>
              Pular esta versão
            </button>
          </>
        )}
        {(status === "upToDate" || status === "error") && (
          <button type="button" onClick={dismiss}>
            Fechar
          </button>
        )}
      </div>
    </div>
  );
}
