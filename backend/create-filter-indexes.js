// One-time setup: indexes that make the list filters and sorting fast.
// Run: node create-filter-indexes.js   (a few minutes; doesn't block the app — CONCURRENTLY)
// Re-run after changing filterFields.js or restoring a new dump. Existing indexes are kept.
//
// Without these, every region / center / ISIC / road / ownership filter reads all rows and unpacks
// the big answers JSON. Each index here is partial (one subsector) on exactly the expression the
// API uses, so Postgres can answer   ("subSectorId" = 'X' AND <expr> = $1) OR (...)   with a
// BitmapOr of small index scans. Search uses trigram indexes on label and caseIds.
require("dotenv").config();
const crypto = require("crypto");
const { Pool } = require("pg");
const { ANSWER_FIELDS, EXTRA_FILTERS } = require("./filterFields");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "pass",
  database: process.env.DB_NAME || "survey",
});
const SCHEMA = process.env.DB_SCHEMA || "public";
const T = `"${SCHEMA}"."SurveyInstance"`;

// Index name from its definition, so changing an expression gives a new index
const nameFor = (tag, def) =>
  `si_${tag}_${crypto.createHash("md5").update(def).digest("hex").slice(0, 10)}`;

const indexes = [];
const filterIdx = (tag, sub, expr) => {
  const def = `((${expr})) WHERE "subSectorId" = '${sub}'`;
  indexes.push({ name: nameFor(tag, def), sql: `USING btree ${def}` });
};
for (const [sub, fields] of Object.entries(ANSWER_FIELDS))
  for (const [key, expr] of Object.entries(fields)) filterIdx(key, sub, expr);
for (const f of EXTRA_FILTERS) filterIdx("x_" + f.key, f.subSectorId, f.expr);
// Sorting by label (both directions, nulls last as the API asks)
indexes.push({ name: "si_label_asc", sql: `("label" ASC NULLS LAST)` });
indexes.push({ name: "si_label_desc", sql: `("label" DESC NULLS LAST)` });
// Search box: substring match on label and caseIds (caseIds holds enumerator / respondent names)
indexes.push({ name: "si_label_trgm", sql: `USING gin ("label" gin_trgm_ops)` });
indexes.push({ name: "si_caseids_trgm", sql: `USING gin ("caseIds" gin_trgm_ops)` });

(async () => {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  const { rows } = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'SurveyInstance'`,
    [SCHEMA]
  );
  const have = new Set(rows.map((r) => r.indexname));
  // Speed up the builds for this session only
  await pool.query("SET maintenance_work_mem = '512MB'");
  for (const ix of indexes) {
    if (have.has(ix.name)) {
      console.log(`ok     ${ix.name}`);
      continue;
    }
    const t = Date.now();
    process.stdout.write(`build  ${ix.name} … `);
    await pool.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${ix.name}" ON ${T} ${ix.sql}`);
    console.log(`${Math.round((Date.now() - t) / 1000)}s`);
  }
  // Statistics on the new expressions, so the planner picks the indexes
  console.log("analyze …");
  await pool.query(`ANALYZE ${T}`);
  console.log("Done.");
  await pool.end();
})().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
