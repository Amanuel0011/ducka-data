import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { navigate } from "./router";
import ExportModal from "./ExportModal.jsx";

// Friendly column titles
const TITLES = {
  label: "Label",
  subSector: "Subsector",
  region: "Region",
  coordinationCenter: "Coordination center",
  isicActivity: "ISIC activity",
  mainRoadCategory: "Main road category",
};

function formatCell(v) {
  if (v === null || v === undefined || v === "") return <span className="null">—</span>;
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v);
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

// Colored tag for the subsector column, by sector
function SubSectorTag({ name }) {
  if (!name) return formatCell(name);
  const kind = name.startsWith("Agriculture")
    ? "agri"
    : name === "Household"
      ? "house"
      : "eco";
  return <span className={"tag tag-" + kind}>{name}</span>;
}

function Select({ label, value, onChange, all, options }) {
  return (
    <label className="filter">
      <span className="filter-label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  );
}

// Dropdown with a search box: type to filter options by text (code or label)
function SearchSelect({ label, value, onChange, all, options }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));
  const q = query.trim().toLowerCase();
  const items = [{ value: "", text: all }, ...options.filter((o) => !q || o.text.toLowerCase().includes(q))];

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => boxRef.current && !boxRef.current.contains(e.target) && close();
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted option in view
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const choose = (o) => {
    onChange(o.value === "" ? "" : String(o.value));
    close();
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (items[active]) choose(items[active]);
    } else if (e.key === "Escape") {
      close();
    }
  };

  return (
    <div className="filter" ref={boxRef}>
      <span className="filter-label">{label}</span>
      <div className="combo">
        <input
          className="input combo-input"
          role="combobox"
          aria-expanded={open}
          placeholder={selected ? selected.text : all}
          value={open ? query : selected ? selected.text : ""}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {open && (
          <ul className="combo-list" role="listbox" ref={listRef}>
            {items.length === 1 && q && <li className="combo-empty">No matches</li>}
            {items.map((o, i) => (
              <li
                key={o.value === "" ? "__all" : o.value}
                role="option"
                aria-selected={String(o.value) === String(value)}
                className={
                  "combo-option" +
                  (i === active ? " active" : "") +
                  (String(o.value) === String(value) ? " selected" : "")
                }
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
              >
                {o.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function DataTable({ table }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(null);
  const [order, setOrder] = useState("asc");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sectors, setSectors] = useState([]);
  const [lookups, setLookups] = useState(null);
  const [sector, setSector] = useState("");
  const [subSector, setSubSector] = useState("");
  const [region, setRegion] = useState("");
  const [center, setCenter] = useState("");
  const [isic, setIsic] = useState("");
  const [road, setRoad] = useState("");
  // Extra filters for the chosen subsector: their definitions and the chosen values ({ key: value })
  const [extraDefs, setExtraDefs] = useState([]);
  const [extra, setExtra] = useState({});
  const extraKey = JSON.stringify(extra);
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    api.sectors().then(setSectors).catch(() => setSectors([]));
    api.lookups().then(setLookups).catch(() => setLookups(null));
  }, []);

  // Load the subsector's extra filters; clear their values when the subsector changes.
  // Some option lists are built on the server after startup, so retry while they're loading.
  useEffect(() => {
    setExtra({});
    setExtraDefs([]);
    if (!subSector) return;
    let stop = false;
    let timer;
    const load = () =>
      api
        .filters(subSector)
        .then((defs) => {
          if (stop) return;
          setExtraDefs(defs);
          if (defs.some((f) => f.loading)) timer = setTimeout(load, 10000);
        })
        .catch(() => !stop && setExtraDefs([]));
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [subSector]);

  // Debounce search typing
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .rows(table, { page, limit, search, sort, order, sector, subSector, region, center, isic, road, extra })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [table, page, limit, search, sort, order, sector, subSector, region, center, isic, road, extraKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const allCols = data?.columns || [];
  const hasId = allCols.some((c) => c.name === "id");

  const sectorObj = sectors.find((s) => s.id === sector);
  const subSectors = sectorObj?.subSectors || [];
  // Coordination center and ISIC only exist for Economy; main road category only for "Other sectors"
  const isEconomy = sectorObj?.code === "ECO";
  const isOtherSectors = isEconomy && subSectors.find((s) => s.id === subSector)?.code === "OTHERSECTOR";
  // Columns shown in the table (main road category only when "Other sectors" is chosen)
  const cols = allCols.filter((c) => !c.hidden && (c.name !== "mainRoadCategory" || isOtherSectors));

  // ISIC activities, limited to the chosen main road category's ISIC divisions (if any)
  const roadObj = lookups?.roadCategories?.find((r) => String(r.code) === String(road));
  const inRoad = (isicCode, r = roadObj) => {
    if (!r?.isicDivisions) return true;
    const div = Math.floor(Number(isicCode) / 100);
    return div >= r.isicDivisions[0] && div <= r.isicDivisions[1];
  };
  // ISIC divisions (first 2 digits of the 4-digit class) that belong to a subsector:
  // Manufacturing = ISIC section C (10-33), Construction = section F (41-43). Other subsectors: all.
  const SUBSECTOR_ISIC = { MANUF: [10, 33], CON: [41, 43] };
  const subCode = (id) => subSectors.find((s) => s.id === id)?.code;
  const inSubSector = (isicCode, id = subSector) => {
    const range = SUBSECTOR_ISIC[subCode(id)];
    if (!range) return true;
    const div = Math.floor(Number(isicCode) / 100);
    return div >= range[0] && div <= range[1];
  };
  const isicList = (lookups?.isic || []).filter((x) => inRoad(x.code) && inSubSector(x.code));
  // Choosing a subsector clears an ISIC activity that doesn't belong to it
  const pickSubSector = (v) => {
    setSubSector(v);
    setRoad("");
    if (isic && !inSubSector(isic, v)) setIsic("");
    setPage(1);
  };
  // Choosing a road category clears an ISIC activity that doesn't belong to it
  const pickRoad = (v) => {
    setRoad(v);
    const r = lookups?.roadCategories?.find((x) => String(x.code) === String(v));
    if (isic && !inRoad(isic, r)) setIsic("");
    setPage(1);
  };

  const toOptions = (list, showCode) =>
    (list || []).map((x) => ({ value: x.code, text: showCode ? `${x.code} – ${x.label}` : x.label }));

  // Set a filter and go back to page 1
  const pick = (setter, ...resets) => (v) => {
    setter(v);
    resets.forEach((r) => r(""));
    setPage(1);
  };

  const setExtraValue = (key) => (v) => {
    setExtra((e) => ({ ...e, [key]: v }));
    setPage(1);
  };
  const subSectorName = subSectors.find((s) => s.id === subSector)?.name;

  const hasExtra = Object.values(extra).some(Boolean);
  const hasFilters = sector || subSector || region || center || isic || road || searchInput || hasExtra;
  const clearAll = () => {
    [setSector, setSubSector, setRegion, setCenter, setIsic, setRoad, setSearchInput].forEach((s) => s(""));
    setExtra({});
    setPage(1);
  };

  // Active filters, shown in the export dialog
  const nameOf = (list, code) => list?.find((x) => String(x.code) === String(code))?.label ?? code;
  const activeFilters = [
    sector && { label: "Sector", value: sectorObj?.name },
    subSector && { label: "Subsector", value: subSectorName },
    region && { label: "Region", value: nameOf(lookups?.regions, region) },
    center && { label: "Coordination center", value: nameOf(lookups?.coordinationCenters, center) },
    road && { label: "Main road category", value: nameOf(lookups?.roadCategories, road) },
    isic && { label: "ISIC", value: `${isic} – ${nameOf(lookups?.isic, isic)}` },
    ...extraDefs
      .filter((f) => extra[f.key])
      .map((f) => ({ label: f.label, value: f.options.find((o) => String(o.value) === String(extra[f.key]))?.text ?? extra[f.key] })),
    search && { label: "Search", value: `"${search}"` },
  ].filter(Boolean);

  const toggleSort = (c) => {
    if (c.virtual) return; // name columns can't be sorted
    if (sort === c.name) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(c.name);
      setOrder("asc");
    }
    setPage(1);
  };

  const from = data && data.total ? (page - 1) * limit + 1 : 0;
  const to = data ? Math.min(page * limit, data.total) : 0;

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Survey cases</h1>
          <p className="muted">Filter by sector and location. Click a row to open the case.</p>
        </div>
        <div className="head-actions">
        <div className="search">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            className="input"
            placeholder="Search by label, owner, phone, ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={() => setShowExport(true)} disabled={!data}>
          ⤓ Export
        </button>
        </div>
      </div>

      {showExport && (
        <ExportModal
          table={table}
          query={{ search, sector, subSector, region, center, isic, road, extra }}
          total={data?.total}
          filters={activeFilters}
          onClose={() => setShowExport(false)}
        />
      )}

      <div className="filters card">
        {sectors.length > 0 && (
          <Select
            label="Sector"
            value={sector}
            all="All sectors"
            options={sectors.map((s) => ({ value: s.id, text: s.name }))}
            onChange={pick(setSector, setSubSector, setCenter, setIsic, setRoad)}
          />
        )}
        {subSectors.length > 0 && (
          <Select
            label="Subsector"
            value={subSector}
            all="All subsectors"
            options={subSectors.map((s) => ({ value: s.id, text: s.name }))}
            onChange={pickSubSector}
          />
        )}
        {lookups && (
          <Select
            label="Region"
            value={region}
            all="All regions"
            options={toOptions(lookups.regions)}
            onChange={pick(setRegion)}
          />
        )}
        {lookups && isEconomy && (
          <SearchSelect
            label="Coordination center"
            value={center}
            all="All centers"
            options={toOptions(lookups.coordinationCenters)}
            onChange={pick(setCenter)}
          />
        )}
        {lookups && isOtherSectors && (
          <Select
            label="Main road category"
            value={road}
            all="All road categories"
            options={toOptions(lookups.roadCategories)}
            onChange={pickRoad}
          />
        )}
        {lookups && isEconomy && (
          <SearchSelect
            label="ISIC"
            value={isic}
            all={roadObj ? "All matching activities" : "All activities"}
            options={toOptions(isicList, true)}
            onChange={pick(setIsic)}
          />
        )}
        {extraDefs.length > 0 && (
          <div className="filters-group">
            <span className="filters-group-title">{subSectorName} filters</span>
            {hasExtra && (
              <button className="btn-link small" onClick={() => (setExtra({}), setPage(1))}>
                Clear {subSectorName?.toLowerCase()} filters
              </button>
            )}
          </div>
        )}
        {extraDefs.map((f) => {
          const Comp = f.search ? SearchSelect : Select;
          return (
            <Comp
              key={f.key}
              label={f.label}
              value={extra[f.key] || ""}
              all={f.loading ? "Loading options…" : f.all}
              options={f.options}
              onChange={setExtraValue(f.key)}
            />
          );
        })}
        {hasFilters && (
          <button className="btn-link" onClick={clearAll}>
            Clear filters
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card table-card">
        <div className={"table-wrap" + (loading ? " loading" : "")}>
          <table className="grid">
            <thead>
              <tr>
                <th className="rownum">#</th>
                {cols.map((c) => (
                  <th
                    key={c.name}
                    className={c.virtual ? "" : "sortable"}
                    onClick={() => toggleSort(c)}
                  >
                    {TITLES[c.name] || c.name}
                    {sort === c.name && <span className="arrow">{order === "asc" ? " ▲" : " ▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row, i) => (
                <tr key={row.id ?? i} onClick={() => hasId && navigate(table, row.id)}>
                  <td className="rownum">{((page - 1) * limit + i + 1).toLocaleString()}</td>
                  {cols.map((c) => (
                    <td key={c.name} className={c.name === "label" ? "cell-label" : ""}>
                      {c.name === "subSector" ? <SubSectorTag name={row[c.name]} /> : formatCell(row[c.name])}
                    </td>
                  ))}
                </tr>
              ))}
              {data && !data.rows.length && (
                <tr>
                  <td colSpan={cols.length + 1} className="empty">
                    No rows match these filters
                  </td>
                </tr>
              )}
              {!data && !error && (
                <tr>
                  <td colSpan={cols.length + 1 || 1} className="empty">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {data && (
          <footer className="pager">
            <div className="pager-info">
              {loading ? (
                <span className="spinner" aria-label="Loading" />
              ) : null}
              <span>
                <strong>{from.toLocaleString()}–{to.toLocaleString()}</strong> of{" "}
                <strong>{data.total.toLocaleString()}</strong> rows
              </span>
              <label className="per-page">
                Rows per page
                <select
                  className="input"
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="pager-nav">
              <button disabled={page <= 1} onClick={() => setPage(1)} title="First page">«</button>
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
              <span className="page-of">
                Page {page.toLocaleString()} of {data.totalPages.toLocaleString()}
              </span>
              <button disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next ›</button>
              <button
                disabled={page >= data.totalPages}
                onClick={() => setPage(data.totalPages)}
                title="Last page"
              >
                »
              </button>
            </div>
          </footer>
        )}
      </div>
    </section>
  );
}
