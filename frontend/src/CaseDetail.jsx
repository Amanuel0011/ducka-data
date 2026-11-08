import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { navigate } from "./router";
import EtradeCards from "./EtradeCards";

const isJsonCol = (c) => c.type === "jsonb" || c.type === "json";
const isEmpty = (v) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.every(isEmpty)) ||
  (typeof v === "object" && !Array.isArray(v) && Object.values(v).every(isEmpty));

// "DATE_OF_INTERVIEW" -> "Date of interview"
function prettyKey(k) {
  const s = String(k).replace(/_+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatValue(v) {
  if (v === null || v === undefined || v === "") return <span className="null">—</span>;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d)) return d.toLocaleString();
  }
  return String(v);
}

// Does this key/value (or anything nested in it) match the filter text?
function matches(key, value, q) {
  if (!q) return true;
  if (String(key).toLowerCase().includes(q)) return true;
  if (value !== null && typeof value === "object")
    return Object.entries(value).some(([k, v]) => matches(k, v, q));
  return String(value ?? "").toLowerCase().includes(q);
}

function Fields({ data, q, hideEmpty, depth = 0 }) {
  const entries = Array.isArray(data)
    ? data.map((v, i) => [`#${i + 1}`, v])
    : Object.entries(data);

  const visible = entries.filter(
    ([k, v]) => matches(k, v, q) && !(hideEmpty && isEmpty(v))
  );
  if (!visible.length) return <p className="muted pad">No matching fields</p>;

  return (
    <table className={"fields depth-" + Math.min(depth, 3)}>
      <tbody>
        {visible.map(([k, v]) =>
          v !== null && typeof v === "object" ? (
            <tr key={k} className="nested">
              <td colSpan={2}>
                <div className="nested-head">
                  {Array.isArray(data) ? k : prettyKey(k)}
                  {!Array.isArray(data) && <code>{k}</code>}
                  {Array.isArray(v) && <span className="muted"> · {v.length} items</span>}
                </div>
                <Fields data={v} q={q} hideEmpty={hideEmpty} depth={depth + 1} />
              </td>
            </tr>
          ) : (
            <tr key={k}>
              <th>
                {Array.isArray(data) ? k : prettyKey(k)}
                {!Array.isArray(data) && <code>{k}</code>}
              </th>
              <td>{formatValue(v)}</td>
            </tr>
          )
        )}
      </tbody>
    </table>
  );
}

function Section({ name, value, q, hideEmpty, open, onToggle }) {
  const count =
    value && typeof value === "object" ? Object.keys(value).length : 1;
  return (
    <div className="section">
      <button className="section-head" onClick={onToggle}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        <span className="section-title">{prettyKey(name)}</span>
        <code>{name}</code>
        <span className="muted section-count">{count} fields</span>
      </button>
      {open &&
        (value && typeof value === "object" ? (
          <Fields data={value} q={q} hideEmpty={hideEmpty} />
        ) : (
          <p className="pad">{formatValue(value)}</p>
        ))}
    </div>
  );
}

// Key fields shown in the top card. Each subsector's questionnaire names them differently,
// so each field lists [section, key] paths to try in order; the first one with a value wins.
// A section of "*" means "this key in any section".
const KEY_FIELDS = [
  {
    title: "Owner name",
    group: "establishment",
    icon: "user",
    paths: [
      ["ADDRESS_OF_THE_ESTABLISHMENT", "NAME_OF_THE_THE_ESTABLISHMENT_OWNER"], // Other sectors
      ["OTHER_INFORMATION", "NAME_OF_THE_THE_ESTABLISHMENT_OWNER"], // Construction
    ],
  },
  {
    title: "TIN",
    group: "establishment",
    icon: "id",
    copy: true,
    etrade: true, // link to the official eTrade business license checker
    paths: [
      ["ADDRESS_OF_THE_ESTABLISHMENT", "TIN_NO"],
      ["NMIS_MAIN_REC", "TIN"], // Manufacturing
      ["OTHER_INFORMATION", "TIN"],
    ],
  },
  {
    title: "Special name of the area",
    group: "establishment",
    icon: "pin",
    paths: [
      ["ADDRESS_OF_THE_ESTABLISHMENT", "SPECIAL_NAME_OF_THE_AREA"],
      ["NMIS_MAIN_REC", "NAME_OF_SPECIFIC_LOCATIONN"],
      ["OTHER_INFORMATION", "SPECIAL_NAME_OF_THE_PLACE"],
    ],
  },
  {
    title: "Respondent name",
    group: "contact",
    icon: "user",
    paths: [
      ["SUMMARY_OF_THE_QUESTIONNAIRE", "RESPONDENT_S_NAME"], // Manufacturing
      ["*", "RESPONDENT_S_NAME"],
    ],
  },
];

// Every phone number anywhere in the answers: the key mentions phone/telephone and the value
// looks like a number (7-15 digits). Skips things like "STATIONERY_TELE_PAYMENTS_FOR_PHONE" = 0.
const PHONE_KEY = /PHONE|TELEPHON/i;
// Readable names for known phone fields; any other phone field uses its own name
const PHONE_NAMES = {
  PRIMARYTELEPHONE_NUMBER: "Primary telephone",
  SECONDARY_TELEPHONE_NUMBER_1: "Secondary telephone",
  TELEPHON_NUMBERR: "Telephone",
  TELEPHONE: "Telephone",
  RESPONDENT_S_PHONE_NUMBER: "Respondent phone",
};
const phoneName = (section, key) =>
  section === "NAME_OF_ENUMERATOR_AND_SUPERVISOR" ? "Enumerator phone" : PHONE_NAMES[key] || prettyKey(key);
const looksLikePhone = (v) =>
  (typeof v === "string" || typeof v === "number") && /^\+?[\d\s-]{7,20}$/.test(String(v).trim()) &&
  String(v).replace(/\D/g, "").length >= 7 && String(v).replace(/\D/g, "").length <= 15;

function phoneValues(answers) {
  const found = [];
  const walk = (o, section, key) => {
    if (Array.isArray(o)) o.forEach((v) => walk(v, section, key));
    else if (o && typeof o === "object")
      Object.entries(o).forEach(([k, v]) => walk(v, section ?? k, k));
    else if (key && PHONE_KEY.test(key) && looksLikePhone(o)) found.push({ section, key, value: String(o).trim() });
  };
  walk(answers, null, null);
  // Same name in two sections -> add the section to tell them apart
  const counts = {};
  found.forEach((f) => (f.name = phoneName(f.section, f.key)));
  found.forEach((f) => (counts[f.name] = (counts[f.name] || 0) + 1));
  return found.map((f, i) => ({
    id: `phone-${i}`,
    title: f.name + (counts[f.name] > 1 ? ` (${prettyKey(f.section)})` : ""),
    hint: prettyKey(f.section),
    value: f.value,
    group: "contact",
    icon: "phone",
    phone: true,
    copy: true,
  }));
}

function keyFieldValues(answers) {
  if (!answers || typeof answers !== "object") return [];
  const fixed = KEY_FIELDS.map(({ title, paths, group, icon, copy, etrade }) => {
    for (const [sec, key] of paths) {
      const sections = sec === "*" ? Object.values(answers) : [answers[sec]];
      for (const section of sections) {
        const v = section && typeof section === "object" ? section[key] : undefined;
        if (!isEmpty(v)) return { title, value: v, group, icon, copy, etrade };
      }
    }
    return null;
  }).filter(Boolean);
  return [...fixed, ...phoneValues(answers)];
}

// Small inline icons (stroke follows the text color)
const ICONS = {
  back: <path d="M19 12H5m6-7-7 7 7 7" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  id: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10h5M7 14h8" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  phone: (
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </>
  ),
  check: <path d="m5 12 5 5 9-10" />,
  building: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18" />
      <path d="M8 7h4M8 11h4M8 15h4" />
    </>
  ),
  code: <path d="m8 8-4 4 4 4m8-8 4 4-4 4" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
};
function Icon({ name, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

// Copy a value to the clipboard, showing a check for a moment
function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(text));
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch {
      /* clipboard not available */
    }
  };
  return (
    <button className={"icon-btn" + (done ? " done" : "")} onClick={copy} title={done ? "Copied" : label} aria-label={label}>
      <Icon name={done ? "check" : "copy"} size={15} />
    </button>
  );
}

// "Name X _ Sector Y" -> { name: X, sector: Y }
function parseLabel(label) {
  const m = /^\s*Name\s+(.*?)\s*_\s*Sector\s+(.*)$/i.exec(label || "");
  if (m) return { name: m[1], sector: m[2] };
  // No sector part: still drop the leading "Name "
  return { name: String(label || "").replace(/^\s*Name\s+/i, "").trim(), sector: "" };
}

// A real TIN is 10 digits; the survey also holds placeholders like "0", "-" or "0000000000"
function cleanTin(v) {
  const d = String(v ?? "").replace(/[\s-]/g, "");
  return /^\d{10}$/.test(d) && !/^(\d)\1{9}$/.test(d) ? d : null;
}
// Official Ministry of Trade checker: shows the registration and all business licenses for a TIN.
// Clicking the TIN's eTrade button loads its registration + licences through our backend (EtradeCards).
const etradeUrl = (tin) => `https://etrade.gov.et/business-license-checker?tin=${encodeURIComponent(tin)}`;
function FieldTile({ f, onEtrade, etradeOpen }) {
  const text = String(f.value);
  return (
    <div className="tile">
      <span className="tile-icon">
        <Icon name={f.icon || "id"} />
      </span>
      <div className="tile-body">
        <div className="tile-label" title={f.hint}>
          {f.title}
        </div>
        <div className="tile-value">
          {f.phone ? <a href={"tel:" + text.replace(/\s/g, "")}>{text}</a> : formatValue(f.value)}
        </div>
      </div>
      {f.etrade && cleanTin(f.value) && (
        <a
          className="etrade-link"
          href={etradeUrl(cleanTin(f.value))}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return; // new-tab clicks open the site
            e.preventDefault();
            onEtrade?.(cleanTin(f.value));
          }}
          title="Look up this TIN's registration and licences on eTrade (Ctrl+click opens etrade.gov.et)"
        >
          <Icon name="external" size={15} />
          <span>{etradeOpen ? "Hide eTrade" : "eTrade license"}</span>
        </a>
      )}
      {f.copy && <CopyButton text={text} label={"Copy " + f.title.toLowerCase()} />}
    </div>
  );
}

// Show the full answers (search bar + all sections) below the Case info card. Off: only the card is shown.
const SHOW_ANSWERS = false;

export default function CaseDetail({ table, id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [openMap, setOpenMap] = useState({});
  const [copied, setCopied] = useState(false);
  const [etradeTin, setEtradeTin] = useState(null);

  useEffect(() => {
    setData(null);
    setError("");
    setEtradeTin(null);
    api
      .row(table, id)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [table, id]);

  const q = filter.trim().toLowerCase();
  const row = data?.row;
  const cols = data?.columns || [];
  const jsonCols = cols.filter((c) => isJsonCol(c));

  // Put the main answers column first
  jsonCols.sort((a, b) => (a.name === "answers" ? -1 : b.name === "answers" ? 1 : 0));

  // Sections of each JSON column (top-level keys)
  const sections = useMemo(() => {
    if (!row) return [];
    return jsonCols.map((c) => {
      const v = row[c.name];
      const items =
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.entries(v)
          : [[c.name, v]];
      return { col: c.name, items };
    });
  }, [row]); // eslint-disable-line react-hooks/exhaustive-deps

  const keyOf = (col, name) => `${col}::${name}`;
  const isOpen = (col, name) => openMap[keyOf(col, name)] ?? true;
  const setAll = (val) => {
    const m = {};
    sections.forEach((s) => s.items.forEach(([n]) => (m[keyOf(s.col, n)] = val)));
    setOpenMap(m);
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(row, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  };

  const title = row?.label || row?.caseIds || id;
  const heading = parseLabel(row?.label);
  const fields = useMemo(() => keyFieldValues(row?.answers), [row]);

  const backButton = (
    <button className="back" onClick={() => navigate(table)} aria-label="Back to list" title="Back to list">
      <span className="back-arrow">
        <Icon name="back" size={16} />
      </span>
    </button>
  );

  return (
    <section className="case">
      {/* Until the case card is shown, keep the back button on its own row */}
      {!row && <div className="case-top">{backButton}</div>}

      {error && <div className="error">{error}</div>}
      {!row && !error && (
        <div className="card case-loading">
          <span className="spinner" /> Loading case…
        </div>
      )}

      {row && (
        <>
          <div className="case-hero-row">
          {backButton}
          <header className="card case-hero">
            <div className="hero-avatar">
              <Icon name="building" size={26} />
            </div>
            <div className="hero-main">
              <h2>{heading.name || title}</h2>
              <div className="hero-meta">
                {heading.sector && <span className="chip">{heading.sector}</span>}
                {row.verified === true && <span className="badge ok">Verified</span>}
                {row.isDeleted === true && <span className="badge warn">Deleted</span>}
              </div>
            </div>
            <div className="controls">
              <button className="btn btn-ghost" onClick={copyJson}>
                <Icon name={copied ? "check" : "code"} size={15} />
                {copied ? "Copied" : "Copy JSON"}
              </button>
            </div>
          </header>
          </div>

          {[
            { key: "establishment", title: "Establishment", icon: "building" },
            { key: "contact", title: "Contact", icon: "phone" },
          ].map((g) => {
            const items = fields.filter((f) => f.group === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key} className="card info-card">
                <h3>
                  <Icon name={g.icon} size={16} />
                  {g.title}
                  <span className="count">{items.length}</span>
                </h3>
                <div className="tiles">
                  {items.map((f) => (
                    <FieldTile
                      key={f.id || f.title}
                      f={f}
                      etradeOpen={f.etrade && etradeTin === cleanTin(f.value)}
                      onEtrade={(tin) => setEtradeTin((t) => (t === tin ? null : tin))}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {etradeTin && (
            <EtradeCards
              key={etradeTin}
              tin={etradeTin}
              siteUrl={etradeUrl(etradeTin)}
              onClose={() => setEtradeTin(null)}
            />
          )}
          {!fields.length && (
            <div className="card info-card">
              <p className="muted pad">No key details found for this case.</p>
            </div>
          )}

          {SHOW_ANSWERS && sections.some((s) => s.items.length) && (
            <div className="answers-bar">
              <input
                className="input"
                placeholder="Find a field or value in this case…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={hideEmpty}
                  onChange={(e) => setHideEmpty(e.target.checked)}
                />
                Hide empty fields
              </label>
              <button className="btn" onClick={() => setAll(true)}>Expand all</button>
              <button className="btn" onClick={() => setAll(false)}>Collapse all</button>
            </div>
          )}

          {SHOW_ANSWERS && sections.map((s) => {
            const items = s.items.filter(
              ([n, v]) => matches(n, v, q) && !(hideEmpty && isEmpty(v))
            );
            return (
              <div key={s.col} className="card">
                <h3>
                  {s.col === "answers" ? "Answers" : s.col}
                  <span className="muted"> · {items.length} sections</span>
                </h3>
                {!items.length && <p className="muted">Nothing to show</p>}
                {items.map(([name, value]) => (
                  <Section
                    key={name}
                    name={name}
                    value={value}
                    q={q}
                    hideEmpty={hideEmpty}
                    open={q ? true : isOpen(s.col, name)}
                    onToggle={() =>
                      setOpenMap((m) => ({
                        ...m,
                        [keyOf(s.col, name)]: !isOpen(s.col, name),
                      }))
                    }
                  />
                ))}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
