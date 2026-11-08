// Where each filter's value lives in the answers JSON, per subsector.
// Shared by index.js (queries) and create-filter-indexes.js (indexes): the expressions must be
// exactly the same text in both, or Postgres won't use the indexes. After changing anything here,
// run `node create-filter-indexes.js` again.
// These are fixed strings (never user input), so they are safe to put in SQL.
const { OWNERSHIP_TYPES } = require("./lookups");

const idKeys = (...keys) => "COALESCE(" + keys.map((k) => `answers->'id'->>'${k}'`).join(", ") + ")";

// Region exists for every subsector; coordination center and ISIC only for Economy.
const ANSWER_FIELDS = {
  // Economy
  "ee05923a-fa71-4361-a52e-be69638ad741": {
    region: `answers->'ADDRESS_OF_THE_ESTABLISHMENT'->>'REGION'`,
    center: `answers->'id'->>'COORDINATION_CENTER'`,
    isic: `answers->'ADDRESS_OF_THE_ESTABLISHMENT'->>'ISIC'`,
    road: `COALESCE(answers->'IS_THE_ESTABLISHMENT'->>'WHAT_IS_THE_MAIN_ROAD_CATAGORY_OF_THE_ESTABLISHM', answers->'ADDRESS_OF_THE_ESTABLISHMENT'->>'WHAT_IS_THE_MAIN_ROAD_CATAGORY_OF_THE_ESTABLISHM_1')`,
  },
  "9bba81b3-29b1-4178-9d18-0386fd0f664c": {
    region: `answers->'NMIS_MAIN_REC'->>'REGION_CODEEE_1'`,
    center: `answers->'id'->>'CORRDINATION_CENTER'`,
    isic: `answers->'NMIS_MAIN_REC'->>'ISIC_CODEE'`,
  },
  "6ba99042-679b-4011-969c-3e0239544b3f": {
    region: `COALESCE(answers->'OTHER_INFORMATION'->>'KILLIL', answers->'OTHER_INFORMATION'->>'KILLIL_1')`,
    // A few rows (older form version) keep it under "id" instead
    center: `COALESCE(answers->'OTHER_INFORMATION'->>'COORDINATION_CENTER_NAME', answers->'id'->>'COORDINATION_CENTER_NAME')`,
    isic: `answers->'OTHER_INFORMATION'->>'ISIC'`,
  },
  // Agriculture: each questionnaire version names the region key differently
  "e46ae64c-c6fb-48b7-b6d4-fa1a2db96c5d": {
    region: idKeys("REGION_L", "LLV01", "PFV01", "FHV01", "V01", "L_V01", "TP01", "UV01", "CL01", "FDV01", "BR", "PM01", "PE1", "MREG"),
  },
  "c31722dd-a33d-48bd-b7a1-470cb9b0262c": {
    region: idKeys("LV_V01", "LV_V01_M2"),
  },
  "fb69673b-abcf-4c7e-b068-5db6b0e505bc": {
    region: idKeys("FR01", "FR01_K", "FR01_W", "COM01_LU", "COM01", "LCOM01"),
  },
  // Household
  "5ffbbc20-55b0-440c-b4b9-bdf3f2b972a0": {
    region: idKeys("WQ11"),
  },
};

// ---- Extra filters for one subsector (sent as ?x_<key>=<value>) ----
// options: fixed code list; dynamic: options are the distinct values found in the data.
const MANUF = "9bba81b3-29b1-4178-9d18-0386fd0f664c";
const OTHER_SECTORS = "ee05923a-fa71-4361-a52e-be69638ad741";
const MB = (k) => `answers->'BASIC_INFORMATION_ON_THE_ESTABLISHEMENT'->>'${k}'`;
const EXTRA_FILTERS = [
  { key: "ownership", label: "Type of ownership", all: "All types", subSectorId: MANUF, expr: MB("TYPE_OF_OWNERSHIP99"), options: OWNERSHIP_TYPES },
  // Other sectors: same 1/2/3 ownership codes. (ADDRESS_OF_THE_ESTABLISHMENT.TYPE_OF_OWNERSHIP_1 is a different 1-11 list.)
  { key: "ownership", label: "Type of ownership", all: "All types", subSectorId: OTHER_SECTORS, expr: `answers->'IS_THE_ESTABLISHMENT'->>'TYPE_OF_OWNERSHIP'`, options: OWNERSHIP_TYPES },
];

module.exports = { ANSWER_FIELDS, EXTRA_FILTERS };
