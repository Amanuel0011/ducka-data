#!/bin/bash
# Runs automatically the first time the Postgres container starts
# (only when the data volume is empty). Restores the survey dump.
set -e

DUMP=/seed/survey_instance.dump

if [ ! -f "$DUMP" ]; then
  echo "No dump found at $DUMP - starting with an empty database."
  exit 0
fi

echo "Restoring $DUMP into database '$POSTGRES_DB'..."

# --no-owner / --no-privileges: skip roles that exist on the old server but not here.
# pg_restore returns non-zero for harmless warnings, so don't let that stop startup.
pg_restore \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --no-owner --no-privileges \
  "$DUMP" || echo "pg_restore finished with warnings (usually safe to ignore)."

echo "Restore complete. Tables:"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c \
  "SELECT table_schema, table_name FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY 1, 2;"
