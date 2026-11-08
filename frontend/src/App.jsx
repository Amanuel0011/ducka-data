import { useEffect, useState } from "react";
import DataTable from "./DataTable.jsx";
import CaseDetail from "./CaseDetail.jsx";
import { parseHash } from "./router";

// The app shows one table: the survey instances
const TABLE = "SurveyInstance";

export default function App() {
  const [route, setRoute] = useState(parseHash());

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/ducka-logo.png" alt="Ducka Labs" />
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-name">Data Explorer</span>
        </div>
      </header>

      <main className="main">
        {/* Keep the list mounted while a case is open so page, filters and sort are kept */}
        <div style={{ display: route.caseId ? "none" : "block" }}>
          <DataTable table={TABLE} />
        </div>
        {route.caseId && <CaseDetail key={route.caseId} table={TABLE} id={route.caseId} />}
      </main>
    </div>
  );
}
