# Survey Viewer

A small full-stack app that shows every table from `survey_instance.dump` as a searchable, sortable, paginated list.

- **backend/**: Node + Express API that reads the restored Postgres database
- **frontend/**: React + Vite UI (table list in the sidebar, data table on the right, click a row for full details)
- **docker-compose.yml**: Postgres 16 on port 5433

It reads the table and column names from the database itself, so it works with whatever tables are in the dump. No models to write.

## 1–2. Build the database (automatic)

Copy the dump into the `db` folder, then start the container:

```bash
cp ~/Documents/survey_instance.dump db/
docker compose up -d
docker compose logs -f db     # watch the restore; Ctrl+C when you see "Restore complete"
```

On the **first** start, `db/init/01-restore.sh` restores the dump into the `survey` database automatically. The data is kept in the `survey_data` Docker volume, so later starts are instant and don't restore again.

To rebuild from scratch (for example, with a newer dump):

```bash
docker compose down -v        # -v deletes the database volume
docker compose up -d          # restores again from db/survey_instance.dump
```

If your tables live in a schema other than `public`, check with:

```bash
docker exec -it survey-db psql -U postgres survey -c "\dn"
```

and set `DB_SCHEMA` in `backend/.env`.

## 3. Run the backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

API runs at http://localhost:4000. Check it with http://localhost:4000/api/tables.

### One-time: speed indexes (after each fresh restore)

```bash
node create-filter-indexes.js   # ~2 min: region / center / ISIC / road / ownership filters, label sort and search
node create-search-index.js     # ~6 min: owner name / phone search table ("SurveyInstanceSearch") + trigger
```

Without them the filters read every row's `answers` JSON (5–40 s per request); with them most requests take under 0.5 s.
Re-run `create-filter-indexes.js` after changing `filterFields.js`, and `create-search-index.js` after changing `searchIndex.js`.
Queries are stopped after 30 s (`DB_STATEMENT_TIMEOUT_MS` in `.env`).

## 4. Run the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Database connection check |
| GET | `/api/tables` | All tables with approximate row counts |
| GET | `/api/tables/:table/columns` | Column names and types |
| GET | `/api/tables/:table/rows?page=1&limit=25&search=&sort=&order=asc` | Paginated rows |
| GET | `/api/tables/:table/rows/:id` | One row by `id` column |
| GET | `/api/tables/:table/export?fields=owner,tin,phone1&<same filters as rows>` | CSV of every row matching the filters, chosen fields only (`excel=1` keeps leading zeros, `skipEmpty=1` drops blank rows). Field list: `/api/export/fields` |
| GET | `/api/etrade/registration/:tin` | eTrade registration for a TIN (proxied, cached 10 min) |
| GET | `/api/etrade/license?tin=&licenseNo=` | eTrade licence status + registered address (proxied) |

Table and column names are checked against the database catalog before use, so the API can't be used for SQL injection through those parameters. Search values are passed as query parameters.

## Notes

- The API is read-only. It never changes data.
- Search looks through every column (`ILIKE`), which can be slow on very large tables. Add indexes or restrict search to specific columns if needed.
- For production, build the frontend with `npm run build` and serve `frontend/dist` from Nginx, proxying `/api` to the backend, the same way as your other projects.
