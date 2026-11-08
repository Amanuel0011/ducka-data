import { useEffect, useState } from "react";
import { api } from "./api";

// eTrade's JSON field names aren't documented and vary (e.g. "RegNo" / "RegistrationNo",
// "LegalCondtion" / "LegalStatus"), so values are looked up by a list of candidate names,
// ignoring case and underscores, anywhere in the object (nested objects included, arrays not).
const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
const blank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function pick(obj, ...names) {
  if (!obj || typeof obj !== "object") return undefined;
  const wanted = names.map(norm);
  const queue = [obj];
  while (queue.length) {
    const o = queue.shift();
    for (const want of wanted)
      for (const [k, v] of Object.entries(o)) if (norm(k) === want && !blank(v)) return v;
    for (const v of Object.values(o)) if (v && typeof v === "object" && !Array.isArray(v)) queue.push(v);
  }
  return undefined;
}
// First array found under one of these names
function pickList(obj, ...names) {
  const v = pick(obj, ...names);
  return Array.isArray(v) ? v : [];
}
// Responses may be wrapped ({ data: {...} }) or be a one-item array
function unwrap(d) {
  if (Array.isArray(d)) return d.length === 1 ? unwrap(d[0]) : d;
  if (d && typeof d === "object") {
    const keys = Object.keys(d);
    const inner = keys.find((k) => /^(data|result|value|payload)$/i.test(k));
    if (inner && d[inner] && typeof d[inner] === "object" && keys.length <= 4) return unwrap(d[inner]);
  }
  return d;
}

// Every licence number in the registration answer (licence list or anywhere else)
const LICENCE_KEY = /^licen[cs]e?(no|number|num)$/;
function licenceNumbers(reg) {
  const out = new Set();
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object")
      Object.entries(o).forEach(([k, v]) => {
        if (LICENCE_KEY.test(norm(k)) && !blank(v) && typeof v !== "object") out.add(String(v).trim());
        else walk(v);
      });
  };
  walk(reg);
  return [...out].slice(0, 10);
}

function fmt(v) {
  if (blank(v)) return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  return s;
}
const money = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return blank(v) ? null : isNaN(n) ? String(v) : n.toLocaleString() + " ETB";
};
// Description of a sector / sub-group entry
const sectorText = (s) =>
  typeof s === "object" && s
    ? [pick(s, "Code", "SubGroupCode"), pick(s, "Description", "DescriptionEng", "Name", "SubGroupName", "DescriptionAmh")]
        .filter((x) => !blank(x))
        .join(" · ")
    : String(s);

// Every key/value in the answer, for the "All fields" view. Skips images and other long blobs.
function flatten(o, prefix = "", out = []) {
  if (Array.isArray(o)) o.forEach((v, i) => flatten(v, `${prefix} #${i + 1}`, out));
  else if (o && typeof o === "object") Object.entries(o).forEach(([k, v]) => flatten(v, prefix ? `${prefix} › ${k}` : k, out));
  else if (!blank(o) && !(typeof o === "string" && o.length > 300)) out.push([prefix, o]);
  return out;
}

function Row({ label, value }) {
  const v = typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? fmt(value) : value;
  if (blank(v) || (Array.isArray(v) && !v.length)) return null;
  return (
    <div className="et-row">
      <dt>{label}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function AllFields({ data }) {
  const rows = flatten(data);
  if (!rows.length) return null;
  return (
    <details className="et-all">
      <summary>All fields from eTrade ({rows.length})</summary>
      <table>
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i}>
              <th>{k}</th>
              <td>{fmt(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const Loading = ({ text }) => (
  <div className="et-loading">
    <span className="spinner" /> {text}
  </div>
);

function RegistrationCard({ state, tin, siteUrl }) {
  const { loading, error, data } = state;
  const d = unwrap(data);
  const managers = pickList(d, "AssociateShortInfos", "Associates", "AssociateInfos", "Managers", "Owners");
  const licences = pickList(d, "Businesses", "Licenses", "Licences", "BusinessLicenses", "LicenseList");
  const sectors = pickList(d, "MainSubGroups", "SubGroups", "Sectors", "BusinessSectors", "MainGroups");

  return (
    <div className="card info-card et-card">
      <h3>
        Business registration
        <span className="et-src">GetRegistrationInfoByTin</span>
      </h3>
      {loading && <Loading text={`Looking up TIN ${tin} on eTrade…`} />}
      {error && (
        <div className="error">
          {error}. <a href={siteUrl} target="_blank" rel="noopener noreferrer">Open TIN {tin} on etrade.gov.et</a>
        </div>
      )}
      {!loading && !error && (!d || typeof d !== "object" || !Object.keys(d).length) && (
        <p className="muted">eTrade has no registration for TIN {tin}.</p>
      )}
      {d && typeof d === "object" && Object.keys(d).length > 0 && (
        <>
          <dl className="et-grid">
            <Row label="Business name (EN)" value={pick(d, "BusinessName", "BusinessNameEng", "BusinessNameEnglish", "NameEng", "EnglishName")} />
            <Row label="Business name (AM)" value={pick(d, "BusinessNameAmh", "BusinessNameAm", "BusinessNameAmharic", "NameAmh", "AmharicName")} />
            <Row label="Trade name" value={pick(d, "TradeName", "TradesName", "TradeNameEng", "TradeNameAmh")} />
            <Row label="TIN" value={pick(d, "Tin", "TinNo", "OwnerTin") ?? tin} />
            <Row label="Registration no." value={pick(d, "RegNo", "RegistrationNo", "RegistrationNumber", "RegNumber")} />
            <Row label="Registration date" value={pick(d, "RegDate", "RegistrationDate", "DateRegistered", "RegisteredDate")} />
            <Row label="Legal status" value={pick(d, "LegalCondtion", "LegalCondition", "LegalStatus", "LegalForm", "BusinessType")} />
            <Row label="Paid-up capital" value={money(pick(d, "PaidUpCapital", "PaidupCapital", "Capital"))} />
          </dl>

          {managers.length > 0 && (
            <div className="et-block">
              <h4>Managers / associates · {managers.length}</h4>
              <ul className="et-list">
                {managers.map((m, i) => (
                  <li key={i}>
                    <strong>{pick(m, "ManagerNameEng", "NameEng", "ManagerName", "Name", "FullName", "ManagerNameAmh") || "—"}</strong>
                    {!blank(pick(m, "ManagerNameAmh", "NameAmh")) && pick(m, "ManagerNameAmh", "NameAmh") !== pick(m, "ManagerNameEng", "NameEng", "ManagerName", "Name") && (
                      <span> · {pick(m, "ManagerNameAmh", "NameAmh")}</span>
                    )}
                    {!blank(pick(m, "Position", "Role", "Title", "PositionEng")) && (
                      <span className="chip">{pick(m, "PositionEng", "Position", "Role", "Title")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {licences.length > 0 && (
            <div className="et-block">
              <h4>Licences · {licences.length}</h4>
              <ul className="et-list">
                {licences.map((l, i) => {
                  const subs = pickList(l, "SubGroups", "Sectors", "BusinessSectors");
                  return (
                    <li key={i}>
                      <strong>{pick(l, "LicenceNumber", "LicenseNumber", "LicenceNo", "LicenseNo") || `Licence ${i + 1}`}</strong>
                      {!blank(pick(l, "TradesName", "TradeName", "TradeNameEng", "TradeNameAmh")) && (
                        <span> · {pick(l, "TradesName", "TradeName", "TradeNameEng", "TradeNameAmh")}</span>
                      )}
                      {!blank(pick(l, "Status", "LicenceStatus", "LicenseStatus")) && (
                        <span className="chip">{String(pick(l, "Status", "LicenceStatus", "LicenseStatus"))}</span>
                      )}
                      {subs.length > 0 && <div className="muted">{subs.map(sectorText).join("; ")}</div>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {sectors.length > 0 && (
            <div className="et-block">
              <h4>Sectors · {sectors.length}</h4>
              <div className="et-chips">
                {sectors.map((s, i) => (
                  <span key={i} className="chip">{sectorText(s)}</span>
                ))}
              </div>
            </div>
          )}

          <AllFields data={d} />
        </>
      )}
    </div>
  );
}

function LicenceDetails({ no, state }) {
  const { loading, error, data } = state;
  const d = unwrap(data);
  const has = d && typeof d === "object" && Object.keys(d).length > 0;
  const status = has && pick(d, "Status", "LicenceStatus", "LicenseStatus", "BusinessStatus");
  const phones = has
    ? [
        ["Mobile", pick(d, "MobilePhone", "Mobile", "MobileNo", "CellPhone")],
        ["Phone", pick(d, "RegularPhone", "Phone", "PhoneNo", "PhoneNumber", "Telephone", "TelephoneNo")],
        ["Fax", pick(d, "Fax", "FaxNo")],
        ["Email", pick(d, "Email", "EmailAddress")],
      ].filter(([, v]) => !blank(v))
    : [];

  return (
    <div className="et-licence">
      <div className="et-licence-head">
        <strong>Licence {no}</strong>
        {status && <span className="chip">{String(status)}</span>}
        {loading && <span className="spinner" />}
      </div>
      {error && <div className="error">{error}</div>}
      {!loading && !error && !has && <p className="muted">No details returned for this licence.</p>}
      {has && (
        <>
          <dl className="et-grid">
            <Row label="Trade name" value={pick(d, "TradesName", "TradeName", "TradeNameEng", "TradeNameAmh")} />
            <Row label="Licence status" value={status} />
            <Row label="Issued" value={pick(d, "DateRegistered", "IssueDate", "IssuedDate", "LicenceIssuedDate")} />
            <Row label="Renewal date" value={pick(d, "RenewalDate", "RenewedDate", "LastRenewalDate", "RenewedFrom")} />
            <Row label="Valid until" value={pick(d, "RenewedTo", "ExpiryDate", "ExpireDate", "ValidUntil", "RenewalDueDate")} />
            <Row label="Capital" value={money(pick(d, "Capital", "PaidUpCapital"))} />
          </dl>
          <div className="et-block">
            <h4>Registered address</h4>
            <dl className="et-grid">
              <Row label="Region" value={pick(d, "Region", "RegionName", "RegionEng")} />
              <Row label="Zone / sub-city" value={pick(d, "Zone", "ZoneName", "SubCity", "Subcity", "ZoneEng")} />
              <Row label="Woreda" value={pick(d, "Woreda", "WoredaName", "WoredaEng")} />
              <Row label="Kebele" value={pick(d, "Kebele", "KebeleName", "KebeleEng")} />
              <Row label="House no." value={pick(d, "HouseNo", "HouseNumber")} />
              {phones.map(([k, v]) => (
                <Row key={k} label={k} value={k === "Email" ? <a href={"mailto:" + v}>{v}</a> : <a href={"tel:" + String(v).replace(/\s/g, "")}>{v}</a>} />
              ))}
            </dl>
          </div>
          <AllFields data={d} />
        </>
      )}
    </div>
  );
}

function LicenceCard({ tin, regState, licences, states }) {
  return (
    <div className="card info-card et-card">
      <h3>
        Licence &amp; address
        <span className="et-src">GetBusinessByLicenseNo</span>
      </h3>
      {regState.loading && <Loading text="Waiting for the licence list…" />}
      {regState.error && <p className="muted">Needs the registration answer to find the licence numbers.</p>}
      {!regState.loading && !regState.error && !licences.length && (
        <p className="muted">No licence numbers were found for TIN {tin}.</p>
      )}
      {licences.map((no) => (
        <LicenceDetails key={no} no={no} state={states[no] || { loading: true }} />
      ))}
    </div>
  );
}

// Two cards for one TIN: 1) registration info, 2) each licence's status and registered address.
// The licence numbers for the second call come from the first answer.
export default function EtradeCards({ tin, siteUrl, onClose }) {
  const [reg, setReg] = useState({ loading: true });
  const [licences, setLicences] = useState([]);
  const [lic, setLic] = useState({});

  useEffect(() => {
    let alive = true;
    setReg({ loading: true });
    setLicences([]);
    setLic({});
    api
      .etradeRegistration(tin)
      .then((data) => {
        if (!alive) return;
        setReg({ data });
        const nos = licenceNumbers(data);
        setLicences(nos);
        nos.forEach((no) =>
          api
            .etradeLicense(tin, no)
            .then((d) => alive && setLic((m) => ({ ...m, [no]: { data: d } })))
            .catch((e) => alive && setLic((m) => ({ ...m, [no]: { error: e.message } })))
        );
      })
      .catch((e) => alive && setReg({ error: e.message }));
    return () => {
      alive = false;
    };
  }, [tin]);

  return (
    <div className="et-wrap">
      <div className="et-bar">
        <span>
          eTrade · TIN <strong>{tin}</strong>
        </span>
        <a href={siteUrl} target="_blank" rel="noopener noreferrer">Open on etrade.gov.et</a>
        <button className="btn btn-ghost" onClick={onClose}>Hide</button>
      </div>
      <div className="et-cards">
        <RegistrationCard state={reg} tin={tin} siteUrl={siteUrl} />
        <LicenceCard tin={tin} regState={reg} licences={licences} states={lic} />
      </div>
    </div>
  );
}
