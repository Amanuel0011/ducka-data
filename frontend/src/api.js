const BASE = import.meta.env.VITE_API_URL || "/api";

async function get(path) {
  const res = await fetch(BASE + path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Query params for the list filters (shared by the rows list and the CSV export)
function filterParams({ search, deep, sector, subSector, region, center, isic, road, extra }) {
  const q = new URLSearchParams();
  if (search) q.set("search", search);
  if (sector) q.set("sector", sector);
  if (sector && subSector) q.set("subSector", subSector);
  if (region) q.set("region", region);
  if (center) q.set("center", center);
  if (isic) q.set("isic", isic);
  if (road) q.set("road", road);
  // Extra subsector filters (e.g. Manufacturing branch, ownership...)
  Object.entries(extra || {}).forEach(([k, v]) => v && q.set("x_" + k, v));
  if (deep) q.set("deep", "1");
  return q;
}

export const api = {
  tables: () => get("/tables"),
  sectors: () => get("/sectors"),
  lookups: () => get("/lookups"),
  filters: (subSector) => get(`/filters?subSector=${encodeURIComponent(subSector)}`),
  rows: (table, opts) => {
    const q = filterParams(opts);
    q.set("page", opts.page);
    q.set("limit", opts.limit);
    if (opts.sort) {
      q.set("sort", opts.sort);
      q.set("order", opts.order);
    }
    return get(`/tables/${encodeURIComponent(table)}/rows?${q}`);
  },
  exportFields: () => get("/export/fields"),
  // Download link for a CSV of every row matching the filters, with only the chosen fields
  exportUrl: (table, opts, fields, { excel, skipEmpty } = {}) => {
    const q = filterParams(opts);
    q.set("fields", fields.join(","));
    if (excel) q.set("excel", "1");
    if (skipEmpty) q.set("skipEmpty", "1");
    return BASE + `/tables/${encodeURIComponent(table)}/export?${q}`;
  },
  etradeRegistration: (tin) => get(`/etrade/registration/${encodeURIComponent(tin)}`),
  etradeLicense: (tin, licenseNo) =>
    get(`/etrade/license?${new URLSearchParams({ tin, licenseNo })}`),
  row: async (table, id) => {
    const data = await get(
      `/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(id)}`
    );
    if (data?.row && Array.isArray(data.columns)) return data;
    if (!data || typeof data !== "object" || Array.isArray(data) || !("id" in data)) {
      throw new Error("Unexpected response while loading case details");
    }

    const columns = await get(
      `/tables/${encodeURIComponent(table)}/columns`
    );
    return { row: data, columns };
  },
};
