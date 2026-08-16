import { useDocumentStore } from "../store/documentStore";

export function ConflictBanner() {
  const resolveConflict = useDocumentStore((state) => state.resolveConflict);

  return (
    <div className="conflict-banner">
      <span>Este arquivo foi alterado por outro programa.</span>
      <div className="conflict-banner-actions">
        <button type="button" onClick={() => void resolveConflict("mine")}>
          Manter minha versão
        </button>
        <button type="button" onClick={() => void resolveConflict("disk")}>
          Usar versão do disco
        </button>
      </div>
    </div>
  );
}
