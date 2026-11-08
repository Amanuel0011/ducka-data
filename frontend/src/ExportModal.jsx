import { useEffect, useRef, useState } from "react";
import { api } from "./api";

// Fields grouped as on the case page. Keys must match EXPORT_FIELDS in backend/index.js.
const GROUPS = [
  { title: "Case", keys: ["id", "label", "subSector", "region", "center", "isic"] },
  { title: "Establishment", keys: ["owner", "tin", "etrade", "area"] },
  { title: "Contact", keys: ["respondent", "phone1", "phone2"] },
];
const TITLES = {
  id: "Case ID",
  label: "Label",
  subSector: "Subsector",
  region: "Region",
  center: "Coordination center",
  isic: "ISIC activity",
  owner: "Owner name",
  tin: "TIN",
  etrade: "eTrade license (link)",
  area: "Special name of the area",
  respondent: "Respondent name",
  phone1: "Primary telephone",
  phone2: "Secondary telephone",
};
const ALL = GROUPS.flatMap((g) => g.keys);
const DEFAULT = ["owner", "tin", "etrade", "area", "phone1", "phone2"];
const PRESETS = [
  { name: "Owner name only", keys: ["owner"] },
  { name: "Phones only", keys: ["phone1", "phone2"] },
  { name: "Owner + phones", keys: ["owner", "phone1", "phone2"] },
  { name: "Default", keys: DEFAULT },
  { name: "All", keys: ALL },
];
const STORE = "export-fields";

function loadSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE));
    if (Array.isArray(v) && v.length) return v.filter((k) => ALL.includes(k));
  } catch {
    /* storage not available */
  }
  return DEFAULT;
}

// Export dialog: choose fields, see which filters apply, download a CSV
export default function ExportModal({ table, query, total, filters, onClose }) {
  const [picked, setPicked] = useState(loadSaved);
  const [excel, setExcel] = useState(true);
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [started, setStarted] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(picked));
    } catch {
      /* storage not available */
    }
  }, [picked]);

  const toggle = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const toggleGroup = (keys) => {
    const all = keys.every((k) => picked.includes(k));
    setPicked((p) => (all ? p.filter((k) => !keys.includes(k)) : [...new Set([...p, ...keys])]));
  };
  const same = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
  // Keep the column order of the list, not the click order
  const ordered = ALL.filter((k) => picked.includes(k));

  const download = () => {
    const a = document.createElement("a");
    a.href = api.exportUrl(table, query, ordered, { excel, skipEmpty });
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStarted(true);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="export-title" tabIndex={-1} ref={dialogRef}>
        <header className="modal-head">
          <div>
            <h2 id="export-title">Export cases</h2>
            <p className="muted">
              <strong>{total?.toLocaleString() ?? "…"}</strong> rows match the current filters
            </p>
          </div>
          <button className="icon-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="modal-body">
          <div className="export-filters">
            <span className="filter-label">Filters applied</span>
            {filters.length ? (
              <div className="chips">
                {filters.map((f) => (
                  <span key={f.label} className="chip">
                    <span className="muted">{f.label}:</span> {f.value}
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted small">None: every case will be exported.</p>
            )}
          </div>

          <div className="export-presets">
            <span className="filter-label">Quick pick</span>
            <div className="chips">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  className={"chip chip-btn" + (same(picked, p.keys) ? " on" : "")}
                  onClick={() => setPicked(p.keys)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="export-groups">
            {GROUPS.map((g) => {
              const n = g.keys.filter((k) => picked.includes(k)).length;
              return (
                <fieldset key={g.title} className="export-group">
                  <legend>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={n === g.keys.length}
                        ref={(el) => el && (el.indeterminate = n > 0 && n < g.keys.length)}
                        onChange={() => toggleGroup(g.keys)}
                      />
                      {g.title}
                    </label>
                  </legend>
                  {g.keys.map((k) => (
                    <label key={k} className="check">
                      <input type="checkbox" checked={picked.includes(k)} onChange={() => toggle(k)} />
                      {TITLES[k]}
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>

          <div className="export-options">
            <label className="check">
              <input type="checkbox" checked={skipEmpty} onChange={(e) => setSkipEmpty(e.target.checked)} />
              Skip rows where all chosen fields are empty
            </label>
            <label className="check">
              <input type="checkbox" checked={excel} onChange={(e) => setExcel(e.target.checked)} />
              Keep leading zeros in phones and TIN when opened in Excel
            </label>
          </div>
        </div>

        <footer className="modal-foot">
          <span className="muted small">
            {started ? "Download started. Large exports can take a minute." : `${ordered.length} field${ordered.length === 1 ? "" : "s"} selected · CSV`}
          </span>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!ordered.length || !total} onClick={download}>
              Download CSV
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
