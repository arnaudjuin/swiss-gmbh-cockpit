"use client";
// Import Folder — scans all receipt images (JPG/PNG) in a server-side folder
// with AI vision and creates expenses. Ports classic showImportModal/startImport
// (static/js/04-expenses.js): POSTs JSON { path } to /expenses/import-folder and
// renders the returned per-file results + imported/total count.
import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

interface ImportResult {
  file: string; status: "ok" | "error"; duplicate?: boolean;
  date?: string; description?: string; amount?: number; error?: string;
}
interface ImportResponse { imported: number; total: number; duplicates: number; results: ImportResult[] }

export function ImportFolderModal({ onClose, onImported }: {
  onClose: () => void; onImported: () => void;
}) {
  const [path, setPath] = useState("scan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState<ImportResponse | null>(null);

  const start = async () => {
    const folder = path.trim();
    if (!folder) { setError("Enter a folder path"); return; }
    setBusy(true); setError(""); setRes(null);
    try {
      const r = await api<ImportResponse>("/expenses/import-folder", {
        method: "POST", body: JSON.stringify({ path: folder }),
      });
      setRes(r);
      onImported();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally { setBusy(false); }
  };

  const doneLabel = res
    ? `Done (${res.imported}/${res.total}${res.duplicates ? `, ${res.duplicates} skipped` : ""})`
    : busy ? "Importing…" : "Scan & Import";

  return (
    <Modal title="Import Folder" onClose={onClose} wide>
      <p className="hint" style={{ margin: "0 0 16px" }}>
        Scan all receipt images (JPG/PNG) in a folder using AI vision analysis.
      </p>
      <label className="field">
        <span className="field__label">Folder path</span>
        <input className="control" value={path} onChange={e => setPath(e.target.value)}
          placeholder="/path/to/receipts" disabled={busy} />
      </label>

      {busy && <p className="hint" style={{ margin: "12px 0" }}>Analyzing receipts with AI vision…</p>}
      {error && <div className="notice notice--danger" style={{ marginTop: 12 }}>{error}</div>}

      {res && (
        <div className="table-card" style={{ marginTop: 12, maxHeight: 260, overflowY: "auto" }}>
          <table className="table table--compact">
            <thead><tr><th>File</th><th>Date</th><th>Description</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {res.results.map((r, i) => (
                <tr key={i}>
                  <td className="mono" style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.file}>{r.file}</td>
                  <td className="date">{r.status === "ok" ? r.date : "—"}</td>
                  <td>{r.status === "ok" ? r.description
                    : <span className="t-danger">{r.error || "Failed"}</span>}</td>
                  <td className="money">{r.status === "ok" && typeof r.amount === "number" ? r.amount.toFixed(2) : "—"}</td>
                  <td>{r.status === "ok"
                    ? (r.duplicate ? <span className="t-warn">DUP</span> : <span className="t-ok">OK</span>)
                    : <span className="t-danger">ERR</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
        <button type="button" className="btn btn--primary" onClick={start} disabled={busy || !!res}>{doneLabel}</button>
      </div>
    </Modal>
  );
}
