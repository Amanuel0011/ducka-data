// Tiny hash router:  #/t/<table>   and   #/t/<table>/case/<id>
export function parseHash() {
  const parts = window.location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .map(decodeURIComponent);
  if (parts[0] !== "t" || !parts[1]) return { table: null, caseId: null };
  return { table: parts[1], caseId: parts[2] === "case" ? parts[3] || null : null };
}

export function navigate(table, caseId) {
  let h = `#/t/${encodeURIComponent(table)}`;
  if (caseId != null) h += `/case/${encodeURIComponent(caseId)}`;
  window.location.hash = h;
}
