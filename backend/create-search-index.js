// One-time setup: fast search on owner name / respondent name / phone numbers.
// Run: node create-search-index.js   (a couple of minutes; re-run after changing SEARCH_PATHS)
//
// The text is copied into a small side table "SurveyInstanceSearch" (id, txt) with a trigram index.
// A trigram match has to be re-checked against the real text; with the text in its own small table
// that check doesn't need to unpack each row's big answers JSON (that made "0911" take ~8s).
// A trigger keeps the table in step with inserts / updates / deletes on "SurveyInstance".
//
// Undo: DROP TABLE "SurveyInstanceSearch"; DROP FUNCTION "SurveyInstanceSearch_sync"() CASCADE;
require("dotenv").config();
const { Pool } = require("pg");
const { SEARCH_EXPR } = require("./searchIndex");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "pass",
  database: process.env.DB_NAME || "survey",
});
const S = `"${process.env.DB_SCHEMA || "public"}"`;
const SRC = `${S}."SurveyInstance"`;
const DST = `${S}."SurveyInstanceSearch"`;
// The same expression, reading from the trigger's NEW row
const NEW_EXPR = SEARCH_EXPR.replace(/answers->/g, "NEW.answers->");

(async () => {
  const t = Date.now();
  const c = await pool.connect();
  try {
    await c.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await c.query("SET maintenance_work_mem = '512MB'");
    await c.query("BEGIN");
    await c.query(`DROP TABLE IF EXISTS ${DST}`);
    await c.query(`CREATE TABLE ${DST} (id text PRIMARY KEY, txt text NOT NULL)`);
    console.log("Copying search text… (a minute or two)");
    await c.query(`INSERT INTO ${DST} (id, txt) SELECT id, ${SEARCH_EXPR} FROM ${SRC}`);
    console.log("Building trigram index…");
    await c.query(`CREATE INDEX "SurveyInstanceSearch_txt_trgm" ON ${DST} USING gin (txt gin_trgm_ops)`);
    await c.query(`
      CREATE OR REPLACE FUNCTION ${S}."SurveyInstanceSearch_sync"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          DELETE FROM ${DST} WHERE id = OLD.id;
          RETURN OLD;
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.id <> NEW.id THEN
          DELETE FROM ${DST} WHERE id = OLD.id;
        END IF;
        INSERT INTO ${DST} (id, txt) VALUES (NEW.id, ${NEW_EXPR})
          ON CONFLICT (id) DO UPDATE SET txt = EXCLUDED.txt;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await c.query(`DROP TRIGGER IF EXISTS "SurveyInstanceSearch_sync" ON ${SRC}`);
    await c.query(
      `CREATE TRIGGER "SurveyInstanceSearch_sync" AFTER INSERT OR UPDATE OF id, answers OR DELETE ON ${SRC}
         FOR EACH ROW EXECUTE FUNCTION ${S}."SurveyInstanceSearch_sync"()`
    );
    await c.query("COMMIT");
    await c.query(`ANALYZE ${DST}`);
    // The old expression index on the big table is replaced by the side table
    await c.query(`DROP INDEX CONCURRENTLY IF EXISTS ${S}."SurveyInstance_owner_contact_trgm_idx"`);
    console.log(`Done in ${Math.round((Date.now() - t) / 1000)}s`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
