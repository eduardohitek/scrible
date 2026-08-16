import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "../store/documentStore";

interface SnapshotInfo {
  timestamp: number;
  size: number;
}

interface RestoreResult {
  content: string;
  mtime: number;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

function formatRelativeTime(timestamp: number): string {
  const diffMinutes = Math.round((timestamp - Date.now()) / 60_000);
  if (Math.abs(diffMinutes) < 60) {
    return relativeTimeFormatter.format(diffMinutes, "minute");
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return relativeTimeFormatter.format(diffHours, "hour");
  }
  const diffDays = Math.round(diffHours / 24);
  return relativeTimeFormatter.format(diffDays, "day");
}

export function HistoryPanel() {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const path = useDocumentStore((state) => state.path);
  const applyExternalContent = useDocumentStore((state) => state.applyExternalContent);

  async function handleToggle() {
    if (!open && path) {
      const list = await invoke<SnapshotInfo[]>("list_snapshots", { path });
      setSnapshots(list);
    }
    setOpen((prev) => !prev);
  }

  async function handleRestore(timestamp: number) {
    if (!path) return;
    const result = await invoke<RestoreResult>("restore_snapshot", { path, timestamp });
    applyExternalContent(result.content, result.mtime);
    setOpen(false);
  }

  return (
    <div className="history-panel-container">
      <button type="button" className="history-toggle" onClick={() => void handleToggle()}>
        Histórico
      </button>
      {open && (
        <div className="history-panel">
          {snapshots.length === 0 ? (
            <p className="history-empty">Nenhum snapshot ainda.</p>
          ) : (
            <ul className="history-list">
              {snapshots.map((snapshot) => (
                <li key={snapshot.timestamp} className="history-item">
                  <span>{formatRelativeTime(snapshot.timestamp)}</span>
                  <button type="button" onClick={() => void handleRestore(snapshot.timestamp)}>
                    Restaurar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
