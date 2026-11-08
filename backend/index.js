require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const {
  REGIONS,
  COORDINATION_CENTERS,
  ISIC,
  ROAD_CATEGORIES,
  YES_NO,
  OWNERSHIP_TYPES,
  LEGAL_STATUS,
  BUILDING_OWNERSHIP,
  NUMBER_OF_SHIFTS,
  MANUFACTURING_BRANCHES,
} = require("./lookups");

const app = express();
app.use(cors());
app.use(express.json());

const SCHEMA = process.env.DB_SCHEMA || "public";

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "pass",
  database: process.env.DB_NAME || "survey",
  // Stop a runaway query instead of letting many of them pile up and slow everything down
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000),
});

// Quote an identifier safely (only used after it is validated against the DB catalog)
const qi = (name) => '"' + String(name).replace(/"/g, '""') + '"';

// Cache table -> columns so we can validate user input against real names
let cache = { at: 0, tables: new Map() };
async function loadCatalog(force = false) {
  if (!force && Date.now() - cache.at < 60_000) return cache.tables;
  const { rows } = await pool.query(
    `SELECT c.table_name, c.column_name, c.data_type, c.ordinal_position
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = $1 AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position`,
    [SCHEMA]
  );
  const tables = new Map();
  for (const r of rows) {
    if (!tables.has(r.table_name)) tables.set(r.table_name, []);
    tables.get(r.table_name).push({ name: r.column_name, type: r.data_type });
  }
  cache = { at: Date.now(), tables };
  return tables;
}

async function getTable(name) {
  const tables = await loadCatalog();
  return tables.has(name) ? tables.get(name) : null;
}

// Sectors and the subSectorIds that belong to each. The dump has no sector table,
// so this mapping was worked out from each subsector's questionnaire fields.
// subSectors with a name are shown in the subsector dropdown; the others are only used for the sector filter.
const SECTORS = [
  {
    id: "c1b9ae98-e77d-4cbc-89e7-a02db021c982",
    name: "Economy",
    code: "ECO",
    subSectors: [
      { id: "9bba81b3-29b1-4178-9d18-0386fd0f664c", code: "MANUF", name: "Manufacturing" },
      { id: "6ba99042-679b-4011-969c-3e0239544b3f", code: "CON", name: "Construction" },
      { id: "ee05923a-fa71-4361-a52e-be69638ad741", code: "OTHERSECTOR", name: "Other sectors" },
    ],
  },
  {
    id: "5ee31054-25ef-4a1c-a81c-cb057748e2d5",
    name: "Agriculture",
    code: "agri_1",
    subSectors: [
      { id: "e46ae64c-c6fb-48b7-b6d4-fa1a2db96c5d" }, // parcels / crops
      { id: "c31722dd-a33d-48bd-b7a1-470cb9b0262c" }, // livestock
      { id: "fb69673b-abcf-4c7e-b068-5db6b0e505bc" }, // frame listing
    ],
  },
  {
    id: "3d2d20cb-a262-45de-a857-b72affbcfec3",
    name: "household",
    code: "household_01",
    subSectors: [{ id: "5ffbbc20-55b0-440c-b4b9-bdf3f2b972a0" }],
  },
];

// The search box also looks at owner name and contact (respondent name, phones) inside the answers.
// That text is one expression with a trigram index on it (see create-search-index.js),
// so these searches do not have to read every row's big answers JSON.
const { SEARCH_EXPR } = require("./searchIndex");
// "+251 911-22 33 44" -> "0911223344" so phone searches match how numbers are stored
const normalizePhone = (s) => {
  if (!/^\+?[\d\s().-]{6,}$/.test(s)) return null;
  let d = s.replace(/\D/g, "");
  if (d.startsWith("251") && d.length >= 12) d = "0" + d.slice(3);
  return d;
};

const { ANSWER_FIELDS, EXTRA_FILTERS } = require("./filterFields");
// Names shown in the table instead of the subSectorId
const SUBSECTOR_NAMES = {
  "9bba81b3-29b1-4178-9d18-0386fd0f664c": "Manufacturing",
  "6ba99042-679b-4011-969c-3e0239544b3f": "Construction",
  "ee05923a-fa71-4361-a52e-be69638ad741": "Other sectors",
  "e46ae64c-c6fb-48b7-b6d4-fa1a2db96c5d": "Agriculture – Crops",
  "c31722dd-a33d-48bd-b7a1-470cb9b0262c": "Agriculture – Livestock",
  "fb69673b-abcf-4c7e-b068-5db6b0e505bc": "Agriculture – Frame listing",
  "5ffbbc20-55b0-440c-b4b9-bdf3f2b972a0": "Household",
};
// Survey table columns shown in the list (others are still sent, but hidden; full data is in the case view)
const SURVEY_VISIBLE = ["label"];

const LOOKUP_FIELDS = [
  // query param / field key, column shown in the table, label list
  { key: "region", column: "region", list: REGIONS },
  { key: "center", column: "coordinationCenter", list: COORDINATION_CENTERS },
  { key: "isic", column: "isicActivity", list: ISIC },
  { key: "road", column: "mainRoadCategory", list: ROAD_CATEGORIES }, // only "Other sectors" has it
];
const labelMaps = Object.fromEntries(
  LOOKUP_FIELDS.map((f) => [f.key, new Map(f.list.map((x) => [String(x.code), x.label]))])
);

// Distinct values of the dynamic filters. One scan of the subsector takes ~20s, so it runs in the
// background at startup and is refreshed every hour; until it's ready those dropdowns are empty.
const SURVEY_TABLE = "SurveyInstance";
const dynamicOptions = new Map(); // filter key -> [{ value, text, count }]
let dynamicLoading = null;
async function loadDynamicOptions() {
  if (dynamicLoading) return dynamicLoading;
  dynamicLoading = (async () => {
    const tables = await loadCatalog();
    if (!tables.has(SURVEY_TABLE)) return;
    const bySub = {};
    for (const f of EXTRA_FILTERS.filter((x) => x.dynamic)) {
      if (!bySub[f.subSectorId]) bySub[f.subSectorId] = [];
      bySub[f.subSectorId].push(f);
    }
    for (const [sub, list] of Object.entries(bySub)) {
      const sql =
        `SELECT ${list.map((f, i) => `${f.expr} AS v${i}, GROUPING(${f.expr}) AS g${i}`).join(", ")}, count(*)::int AS n ` +
        `FROM ${qi(SCHEMA)}.${qi(SURVEY_TABLE)} WHERE "subSectorId" = $1 ` +
        `GROUP BY GROUPING SETS (${list.map((f) => `(${f.expr})`).join(", ")})`;
      const { rows } = await pool.query(sql, [sub]);
      list.forEach((f, i) => {
        let opts = rows
          .filter((r) => r["g" + i] === 0 && r["v" + i] != null && String(r["v" + i]).trim() !== "")
          .map((r) => ({ value: String(r["v" + i]), text: String(r["v" + i]).trim(), count: r.n }))
          .filter((o) => o.count >= (f.minCount || 1));
        if (f.year) {
          // keep plausible E.C. years only, newest first
          opts = opts.filter((o) => /^\d{4}$/.test(o.value) && +o.value >= 1900 && +o.value <= 2030);
          opts.sort((a, b) => b.value - a.value);
        } else {
          opts.sort((a, b) => a.text.localeCompare(b.text));
        }
        dynamicOptions.set(f.key, opts);
      });
    }
  })()
    .catch((e) => console.error("Loading filter options failed:", e.message))
    .finally(() => {
      dynamicLoading = null;
    });
  return dynamicLoading;
}
loadDynamicOptions();
setInterval(loadDynamicOptions, 60 * 60 * 1000);

// Filters for one subsector, with their options
app.get("/api/filters", (req, res) => {
  const sub = String(req.query.subSector || "");
  res.json(
    EXTRA_FILTERS.filter((f) => f.subSectorId === sub).map((f) => ({
      key: f.key,
      label: f.label,
      all: f.all,
      search: !!(f.dynamic || f.search), // long lists get a search box
      loading: !!f.dynamic && !dynamicOptions.has(f.key),
      options: f.dynamic
        ? dynamicOptions.get(f.key) || []
        : f.options.map((o) => ({ value: String(o.code), text: o.label })),
    }))
  );
});

app.get("/api/lookups", (_req, res) => {
  res.json({
    regions: REGIONS,
    coordinationCenters: COORDINATION_CENTERS,
    isic: ISIC,
    roadCategories: ROAD_CATEGORIES,
  });
});

app.get("/api/sectors", (_req, res) => {
  res.json(
    SECTORS.map(({ id, name, code, subSectors }) => ({
      id,
      name,
      code,
      subSectors: subSectors.filter((s) => s.name),
    }))
  );
});

// Health check
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// List all tables with approximate row counts
app.get("/api/tables", async (_req, res, next) => {
  try {
    const tables = await loadCatalog(true);
    const { rows } = await pool.query(
      `SELECT relname AS name, GREATEST(reltuples, 0)::bigint AS estimate
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r'`,
      [SCHEMA]
    );
    const est = Object.fromEntries(rows.map((r) => [r.name, Number(r.estimate)]));
    res.json(
      [...tables.keys()].map((name) => ({
        name,
        columns: tables.get(name).length,
        rowEstimate: est[name] ?? 0,
      }))
    );
  } catch (e) {
    next(e);
  }
});

// Column info for one table
app.get("/api/tables/:table/columns", async (req, res, next) => {
  try {
    const cols = await getTable(req.params.table);
    if (!cols) return res.status(404).json({ error: "Table not found" });
    res.json(cols);
  } catch (e) {
    next(e);
  }
});

// WHERE clause for the list filters (search, sector, region, center, ISIC, road, extra filters).
// Shared by the rows list and the CSV export so both return exactly the same rows.
async function buildWhere(req, table, cols) {
  const colNames = cols.map((c) => c.name);
  const from = `${qi(SCHEMA)}.${qi(table)}`;
  const isJson = (c) => c.type === "jsonb" || c.type === "json";
  const search = (req.query.search || "").trim();

  // Searching big JSON columns is slow on large tables, so it's opt-in (?deep=1)
  const deep = req.query.deep === "1";
  const searchCols = cols.filter((c) => deep || !isJson(c)).map((c) => c.name);

  const params = [];
  const conds = [];
  const fastSearch =
    !deep && table === SURVEY_TABLE && (await getTable("SurveyInstanceSearch")) && ["answers", "id", "label", "caseIds"].every((c) => colNames.includes(c));
  if (search && fastSearch) {
    // Every part here has an index (trigram on label / caseIds / owner+phone text, btree on
    // the ids), so Postgres never has to read the whole table.
    // IDs are matched exactly: nobody types half a UUID.
    // Substring matching needs 3+ characters (trigram indexes); shorter text only matches IDs exactly.
    const isGuid = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(search);
    const ors = [];
    const likes = [];
    if (search.length >= 3 && !isGuid) {
      params.push(`%${search}%`);
      const n = params.length;
      ors.push(`"label" ILIKE $${n}`, `"caseIds" ILIKE $${n}`);
      // Owner / respondent names and phones: pre-built text in "SurveyInstanceSearch" (see create-search-index.js)
      likes.push(`txt ILIKE $${n}`);
      const phone = normalizePhone(search);
      if (phone && phone !== search && phone.length >= 3) {
        params.push(`%${phone}%`);
        likes.push(`txt ILIKE $${params.length}`);
      }
    }
    // A UUID / 32-hex guid: match the id columns directly (one establishmentId can cover many rows,
    // too many to pass through an id list).
    if (isGuid) {
      params.push(search);
      const e = params.length;
      const eq = ["id", "establishmentId", "sourceGuid"].filter((c) => colNames.includes(c)).map((c) => `${qi(c)} = $${e}`);
      conds.push("(" + eq.join(" OR ") + ")");
    } else {
      params.push(search);
      const e = params.length;
      ors.push(`id = $${e}`);
      if (colNames.includes("sourceId") && /^\d{1,18}$/.test(search)) ors.push(`"sourceId" = $${e}::bigint`);
      // One id list from two indexed lookups. (A sub-query OR'ed with other conditions would make
      // Postgres read the whole table instead.)
      const parts = [`SELECT id FROM ${from} WHERE ${ors.join(" OR ")}`];
      if (likes.length) parts.unshift(`SELECT id FROM ${qi(SCHEMA)}."SurveyInstanceSearch" WHERE ${likes.join(" OR ")}`);
      conds.push(`id IN (${parts.join(" UNION ALL ")})`);
    }
  } else if (search && searchCols.length) {
    params.push(`%${search}%`);
    const n = params.length;
    const ors = searchCols.map((c) => `${qi(c)}::text ILIKE $${n}`);
    // Also match owner name / respondent name / phone numbers inside the answers.
    // Done as an id sub-query so Postgres can use the trigram index for it.
    if (!deep && table === "SurveyInstance" && colNames.includes("answers") && colNames.includes("id")) {
      const likes = [`${SEARCH_EXPR} ILIKE $${n}`];
      const phone = normalizePhone(search);
      if (phone && phone !== search) {
        params.push(`%${phone}%`);
        likes.push(`${SEARCH_EXPR} ILIKE $${params.length}`);
      }
      ors.push(`id IN (SELECT id FROM ${from} WHERE ${likes.join(" OR ")})`);
    }
    conds.push("(" + ors.join(" OR ") + ")");
  }
  // ?sector=<sector id>[&subSector=<subSectorId>]: keep only rows in that sector / subsector
  const sector = SECTORS.find((s) => s.id === req.query.sector);
  if (sector && colNames.includes("subSectorId")) {
    const sub = sector.subSectors.find((s) => s.id === req.query.subSector);
    params.push(sub ? [sub.id] : sector.subSectors.map((s) => s.id));
    conds.push(`"subSectorId" = ANY($${params.length}::text[])`);
  }
  // ?region=&center=&isic=: match the codes inside each subsector's answers.
  // Only subsectors that have every chosen field can match (center/ISIC exist only for Economy).
  const hasAnswers = colNames.includes("subSectorId") && colNames.includes("answers");
  const active = hasAnswers
    ? LOOKUP_FIELDS.filter((f) => /^\d+$/.test(String(req.query[f.key] ?? "")))
    : [];
  if (active.length) {
    let scope = Object.keys(ANSWER_FIELDS);
    if (sector) {
      const chosen = sector.subSectors.find((s) => s.id === req.query.subSector);
      scope = chosen ? [chosen.id] : sector.subSectors.map((s) => s.id);
    }
    scope = scope.filter((id) => active.every((f) => ANSWER_FIELDS[id]?.[f.key]));
    if (!scope.length) {
      conds.push("FALSE");
    } else {
      const nums = active.map((f) => {
        params.push(String(Number(req.query[f.key])));
        return params.length;
      });
      conds.push(
        "(" +
          scope
            .map(
              (id) =>
                `("subSectorId" = '${id}' AND ` +
                active.map((f, i) => `${ANSWER_FIELDS[id][f.key]} = $${nums[i]}`).join(" AND ") +
                ")"
            )
            .join(" OR ") +
          ")"
      );
    }
  }
  // ?x_<key>=<value>: extra subsector filters (they also limit the rows to that subsector).
  // Several subsectors can share a key (e.g. "ownership"); those are OR'ed, and when a subsector
  // is chosen only its own filter is used.
  if (hasAnswers) {
    const byKey = new Map();
    for (const f of EXTRA_FILTERS) {
      if (req.query.subSector && f.subSectorId !== req.query.subSector) continue;
      const v = req.query["x_" + f.key];
      if (typeof v !== "string" || v === "" || v.length > 200) continue;
      const opt = f.options && f.options.find((o) => String(o.code) === v);
      if (f.options && !opt) continue;
      let cond;
      if (opt && opt.values) {
        // one option covering several stored spellings
        params.push(opt.values);
        cond = `("subSectorId" = '${f.subSectorId}' AND ${f.expr} = ANY($${params.length}::text[]))`;
      } else {
        params.push(v);
        cond = `("subSectorId" = '${f.subSectorId}' AND ${f.expr} = $${params.length})`;
      }
      if (!byKey.has(f.key)) byKey.set(f.key, []);
      byKey.get(f.key).push(cond);
    }
    for (const list of byKey.values()) conds.push("(" + list.join(" OR ") + ")");
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  return { where, params, colNames, from, isJson, hasAnswers };
}

// Rows with pagination, search and sorting
// GET /api/tables/:table/rows?page=1&limit=25&search=abc&sort=col&order=asc
app.get("/api/tables/:table/rows", async (req, res, next) => {
  try {
    const table = req.params.table;
    const cols = await getTable(table);
    if (!cols) return res.status(404).json({ error: "Table not found" });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    const colNames = cols.map((c) => c.name);
    const sort = colNames.includes(req.query.sort) ? req.query.sort : null;
    const order = String(req.query.order).toLowerCase() === "desc" ? "DESC" : "ASC";
    const { where, params, from, isJson, hasAnswers } = await buildWhere(req, table, cols);
    const orderBy = sort ? `ORDER BY ${qi(sort)} ${order} NULLS LAST` : "";

    // In the list, send only a short preview of JSON columns; full data comes from the detail endpoint
    let selectList = cols
      .map((c) =>
        isJson(c) ? `left(${qi(c.name)}::text, 160) AS ${qi(c.name)}` : qi(c.name)
      )
      .join(", ");
    // Codes for region / coordination center / ISIC, turned into names below
    if (hasAnswers) {
      for (const f of LOOKUP_FIELDS) {
        const cases = Object.entries(ANSWER_FIELDS)
          .filter(([, e]) => e[f.key])
          .map(([id, e]) => `WHEN '${id}' THEN ${e[f.key]}`)
          .join(" ");
        selectList += `, CASE "subSectorId" ${cases} END AS ${qi("_code_" + f.key)}`;
      }
    }

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::bigint AS total FROM ${from} ${where}`, params),
      pool.query(
        // Pick the page's ids first, then build the JSON previews / codes for just those rows.
        // Otherwise a sorted search builds them for every match before keeping 25.
        colNames.includes("id")
          ? `WITH page AS (SELECT id FROM ${from} ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}) ` +
              `SELECT ${selectList} FROM ${from} WHERE id IN (SELECT id FROM page) ${orderBy}`
          : `SELECT ${selectList} FROM ${from} ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
        params
      ),
    ]);

    const total = Number(countRes.rows[0].total);
    let columns = cols;
    let rows = dataRes.rows;
    if (hasAnswers) {
      rows = rows.map((r) => {
        const out = {};
        for (const f of LOOKUP_FIELDS) {
          const code = r["_code_" + f.key];
          delete r["_code_" + f.key];
          out[f.column] =
            code == null || code === "" ? null : labelMaps[f.key].get(code) ?? `Unknown (${code})`;
        }
        out.subSector = SUBSECTOR_NAMES[r.subSectorId] ?? r.subSectorId;
        return { ...out, ...r };
      });
      const visible = cols.filter((c) => SURVEY_VISIBLE.includes(c.name));
      columns = [
        ...visible, // label first
        { name: "subSector", type: "lookup", virtual: true },
        ...LOOKUP_FIELDS.map((f) => ({ name: f.column, type: "lookup", virtual: true })),
        ...cols.filter((c) => !SURVEY_VISIBLE.includes(c.name)).map((c) => ({ ...c, hidden: true })),
      ];
    }
    res.json({
      table,
      columns,
      rows,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (e) {
    next(e);
  }
});

// ---- CSV export of the filtered rows ------------------------------------------------------
// Each field is [section, key] paths tried in order (first non-empty wins), like the case view's
// key fields. Fixed strings, never user input, so they are safe to put in SQL.
const firstOf = (paths) =>
  "COALESCE(" + paths.map(([a, b]) => `NULLIF(trim(answers->'${a}'->>'${b}'), '')`).join(", ") + ")";
const lookupCase = (key) => {
  const cases = Object.entries(ANSWER_FIELDS)
    .filter(([, e]) => e[key])
    .map(([id, e]) => `WHEN '${id}' THEN ${e[key]}`)
    .join(" ");
  return `CASE "subSectorId" ${cases} END`;
};
const TIN_EXPR = firstOf([
  ["ADDRESS_OF_THE_ESTABLISHMENT", "TIN_NO"],
  ["NMIS_MAIN_REC", "TIN"],
  ["OTHER_INFORMATION", "TIN"],
]);
// A real TIN is 10 digits (not placeholders like "0" or "0000000000")
const realTin = (v) => {
  const d = String(v ?? "").replace(/[\s-]/g, "");
  return /^\d{10}$/.test(d) && !/^(\d)\1{9}$/.test(d) ? d : null;
};
// key: sent as ?fields=a,b,c   text: true = keep as text in Excel (leading zeros)
const EXPORT_FIELDS = [
  { key: "id", title: "Case ID", sql: `id` },
  { key: "label", title: "Label", sql: `"label"` },
  { key: "subSector", title: "Subsector", sql: `"subSectorId"`, map: (v) => SUBSECTOR_NAMES[v] ?? v },
  { key: "region", title: "Region", sql: lookupCase("region"), map: (v) => labelMaps.region.get(String(v)) ?? v },
  { key: "center", title: "Coordination center", sql: lookupCase("center"), map: (v) => labelMaps.center.get(String(v)) ?? v },
  { key: "isic", title: "ISIC activity", sql: lookupCase("isic"), map: (v) => (labelMaps.isic.has(String(v)) ? `${v} – ${labelMaps.isic.get(String(v))}` : v) },
  {
    key: "owner",
    title: "Owner name",
    sql: firstOf([
      ["ADDRESS_OF_THE_ESTABLISHMENT", "NAME_OF_THE_THE_ESTABLISHMENT_OWNER"],
      ["OTHER_INFORMATION", "NAME_OF_THE_THE_ESTABLISHMENT_OWNER"],
    ]),
  },
  { key: "tin", title: "TIN", sql: TIN_EXPR, text: true },
  {
    key: "etrade",
    title: "eTrade license",
    sql: TIN_EXPR,
    map: (v) => (realTin(v) ? `https://etrade.gov.et/business-license-checker?tin=${realTin(v)}` : null),
  },
  {
    key: "area",
    title: "Special name of the area",
    sql: firstOf([
      ["ADDRESS_OF_THE_ESTABLISHMENT", "SPECIAL_NAME_OF_THE_AREA"],
      ["NMIS_MAIN_REC", "NAME_OF_SPECIFIC_LOCATIONN"],
      ["OTHER_INFORMATION", "SPECIAL_NAME_OF_THE_PLACE"],
    ]),
  },
  {
    key: "respondent",
    title: "Respondent name",
    sql: firstOf([
      ["SUMMARY_OF_THE_QUESTIONNAIRE", "RESPONDENT_S_NAME"],
      ["ADDRESS_OF_THE_ESTABLISHMENT", "RESPONDENT_S_NAME"],
      ["OTHER_INFORMATION", "RESPONDENT_S_NAME"],
    ]),
  },
  {
    key: "phone1",
    title: "Primary telephone",
    text: true,
    sql: firstOf([
      ["ADDRESS_OF_THE_ESTABLISHMENT", "PRIMARYTELEPHONE_NUMBER"],
      ["OTHER_INFORMATION", "TELEPHONE"],
      ["NMIS_MAIN_REC", "TELEPHON_NUMBERR"],
      ["SUMMARY_OF_THE_QUESTIONNAIRE", "RESPONDENT_S_PHONE_NUMBER"],
      ["ADDRES_OF_HEAD_OFFICE", "TELEPHONE2"],
      ["HHINFO", "P_PHONE_NO_1"],
      ["HH_LISTING", "F0_PHONE_NO_1"],
      ["UR_LISTING_REC", "F0_PHONE_NO_1"],
      ["COMFRAMEUPDAT", "FUQ15_PHONE1"],
    ]),
  },
  {
    key: "phone2",
    title: "Secondary telephone",
    text: true,
    sql: firstOf([
      ["ADDRESS_OF_THE_ESTABLISHMENT", "SECONDARY_TELEPHONE_NUMBER_1"],
      ["OTHER_INFORMATION", "SECONDARY_TELEPHONE_NUMBER_1"],
      ["NMIS_MAIN_REC", "ALTERNATIVE_TELEPHON_NUMBERR"],
      ["HHINFO", "P_PHONE_NO_2"],
      ["HH_LISTING", "F0_PHONE_NO_2"],
      ["UR_LISTING_REC", "F0_PHONE_NO_2"],
      ["COMFRAMEUPDAT", "FUQ15_PHONE2"],
    ]),
  },
];

app.get("/api/export/fields", (_req, res) => {
  res.json(EXPORT_FIELDS.map(({ key, title }) => ({ key, title })));
});

// GET /api/tables/:table/export?fields=owner,phone1&<same filters as /rows>&excel=1
// Streams a CSV of every matching row, read in batches by id so memory stays small.
const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
app.get("/api/tables/:table/export", async (req, res, next) => {
  try {
    const table = req.params.table;
    const cols = await getTable(table);
    if (!cols) return res.status(404).json({ error: "Table not found" });
    const colNames = cols.map((c) => c.name);
    if (!["id", "answers", "subSectorId", "label"].every((c) => colNames.includes(c))) {
      return res.status(400).json({ error: "Export is only available for the survey table" });
    }
    const wanted = String(req.query.fields || "").split(",").filter(Boolean);
    const fields = EXPORT_FIELDS.filter((f) => wanted.includes(f.key));
    if (!fields.length) return res.status(400).json({ error: "Choose at least one field to export" });
    // Excel drops leading zeros from numbers (0911… -> 911…); ="0911…" keeps them as text
    const excel = req.query.excel === "1";
    // Skip rows where every chosen field is empty (e.g. only "phone" chosen and no phone)
    const skipEmpty = req.query.skipEmpty === "1";

    const { where, params, from } = await buildWhere(req, table, cols);
    const selectList = fields.map((f, i) => `${f.sql} AS c${i}`).join(", ");
    const idParam = params.length + 1;
    const batchSql =
      `SELECT id AS _id, ${selectList} FROM ${from} ` +
      (where ? `${where} AND ` : "WHERE ") +
      `id > $${idParam} ORDER BY id LIMIT 5000`;

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="survey-export-${stamp}.csv"`);
    // BOM so Excel reads Amharic / UTF-8 text correctly
    res.write("﻿" + fields.map((f) => csvCell(f.title)).join(",") + "\r\n");

    let closed = false;
    req.on("close", () => (closed = true));
    let last = "";
    for (;;) {
      if (closed) return;
      const { rows } = await pool.query(batchSql, [...params, last]);
      if (!rows.length) break;
      let chunk = "";
      for (const r of rows) {
        const vals = fields.map((f, i) => {
          let v = r["c" + i];
          if (f.map && v != null) v = f.map(v);
          return v == null || v === "" ? null : v;
        });
        if (skipEmpty && vals.every((v) => v == null)) continue;
        chunk += vals.map((v, i) => csvCell(excel && fields[i].text && v != null ? `="${v}"` : v)).join(",") + "\r\n";
      }
      if (chunk && !res.write(chunk)) await new Promise((r) => res.once("drain", r));
      last = rows[rows.length - 1]._id;
      if (rows.length < 5000) break;
    }
    res.end();
  } catch (e) {
    if (res.headersSent) {
      console.error("Export failed:", e.message);
      return res.destroy(e);
    }
    next(e);
  }
});

// Single row by primary key column "id" (if the table has one)
app.get("/api/tables/:table/rows/:id", async (req, res, next) => {
  try {
    const cols = await getTable(req.params.table);
    if (!cols) return res.status(404).json({ error: "Table not found" });
    const idCol = cols.find((c) => c.name === "id");
    if (!idCol) return res.status(400).json({ error: "Table has no id column" });
    // Compare text ids directly so Postgres can use the primary-key index
    const cond = idCol.type === "text" || idCol.type === "character varying"
      ? "id = $1"
      : "id::text = $1";
    const { rows } = await pool.query(
      `SELECT * FROM ${qi(SCHEMA)}.${qi(req.params.table)} WHERE ${cond} LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Row not found" });
    res.json({ columns: cols, row: rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---- eTrade (Ministry of Trade) lookups --------------------------------------------------
// The browser can't call etrade.gov.et directly (CORS), so the backend fetches it and passes
// the JSON through. Answers are cached for 10 minutes to avoid repeat calls for the same TIN.
// etrade.gov.et sends the wrong intermediate certificate (GlobalSign EV CA G3 instead of the
// "GlobalSign GCC R3 EV TLS CA 2025" that signed it). Browsers fetch the right one on their own;
// Node doesn't, so it fails with "fetch failed" (UNABLE_TO_VERIFY_LEAF_SIGNATURE). We bundle that
// intermediate (from http://secure.globalsign.com/cacert/gsgccr3evtlsca2025.crt, valid to Jul 2027)
// and trust it for eTrade requests only. Certificate checks stay fully on.
const https = require("https");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const etradeAgent = new https.Agent({
  keepAlive: true,
  ca: [...tls.rootCertificates, fs.readFileSync(path.join(__dirname, "certs/globalsign-gcc-r3-ev-tls-ca-2025.pem"), "utf8")],
});
const ETRADE = "https://etrade.gov.et/api";
const etradeCache = new Map();
function httpsGetText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: etradeAgent, headers: { Accept: "application/json" }, timeout: 20_000 }, (r) => {
      let body = "";
      r.setEncoding("utf8");
      r.on("data", (c) => (body += c));
      r.on("end", () => resolve({ status: r.statusCode, text: body }));
      r.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("eTrade did not answer in time"), { status: 504 })));
    req.on("error", (e) =>
      reject(e.status ? e : Object.assign(new Error(`Could not reach eTrade (${e.code || e.message})`), { status: 502 }))
    );
  });
}
async function etradeGet(path) {
  const hit = etradeCache.get(path);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
  const { status, text } = await httpsGetText(ETRADE + path);
  if (status < 200 || status >= 300) {
    // eTrade only serves its API to its own web pages and answers anything else with
    // 417 "Invalid referer header"; pass a short reason on so the page can show it.
    const reason = /referer/i.test(text)
      ? "eTrade only allows its own website to use this data (\"Invalid referer header\")"
      : text && text.length < 200 ? `eTrade answered ${status}: ${text.trim()}` : `eTrade answered ${status}`;
    const err = new Error(reason);
    err.status = status === 404 ? 404 : 502;
    throw err;
  }
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const err = new Error("eTrade did not return JSON");
    err.status = 502;
    throw err;
  }
  etradeCache.set(path, { at: Date.now(), data });
  if (etradeCache.size > 500) etradeCache.delete(etradeCache.keys().next().value);
  return data;
}
const validTin = (t) => /^\d{10}$/.test(String(t || ""));
const sendEtradeError = (res, e) =>
  res.status(e.status || 502).json({
    error: e.name === "TimeoutError" ? "eTrade did not answer in time" : e.message || "eTrade request failed",
  });

// 1. Registration by TIN: business name (EN/AM), trade name, reg no/date, legal status,
//    paid-up capital, managers/associates, licence list, sectors
app.get("/api/etrade/registration/:tin", async (req, res) => {
  const { tin } = req.params;
  if (!validTin(tin)) return res.status(400).json({ error: "TIN must be 10 digits" });
  try {
    res.json(await etradeGet(`/Registration/GetRegistrationInfoByTin/${tin}/am`));
  } catch (e) {
    sendEtradeError(res, e);
  }
});

// 2. Licence by number: status / renewal date, registered address (region, zone, woreda, kebele, house no), phones
app.get("/api/etrade/license", async (req, res) => {
  const tin = String(req.query.tin || "");
  const licenseNo = String(req.query.licenseNo || "").trim();
  if (!validTin(tin)) return res.status(400).json({ error: "TIN must be 10 digits" });
  if (!licenseNo || licenseNo.length > 60) return res.status(400).json({ error: "Licence number is required" });
  try {
    const q = new URLSearchParams({ LicenseNo: licenseNo, Tin: tin, Lang: "en" });
    res.json(await etradeGet(`/BusinessMain/GetBusinessByLicenseNo?${q}`));
  } catch (e) {
    sendEtradeError(res, e);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
