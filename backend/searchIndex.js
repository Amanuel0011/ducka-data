// Owner name and contact fields (respondent name, phone numbers) that the search box looks in,
// joined into one text value. Fixed strings (never user input), so they are safe to put in SQL.
// The expression must stay exactly the same as the one in the index, or Postgres won't use it:
// after changing this list, run `node create-search-index.js` again.
const SEARCH_PATHS = [
  ["ADDRESS_OF_THE_ESTABLISHMENT", "NAME_OF_THE_THE_ESTABLISHMENT_OWNER"], // Other sectors
  ["OTHER_INFORMATION", "NAME_OF_THE_THE_ESTABLISHMENT_OWNER"], // Construction
  ["SUMMARY_OF_THE_QUESTIONNAIRE", "RESPONDENT_S_NAME"], // Manufacturing
  ["ADDRESS_OF_THE_ESTABLISHMENT", "RESPONDENT_S_NAME"],
  ["OTHER_INFORMATION", "RESPONDENT_S_NAME"],
  ["ADDRESS_OF_THE_ESTABLISHMENT", "PRIMARYTELEPHONE_NUMBER"],
  ["ADDRESS_OF_THE_ESTABLISHMENT", "SECONDARY_TELEPHONE_NUMBER_1"],
  ["OTHER_INFORMATION", "TELEPHONE"],
  ["OTHER_INFORMATION", "SECONDARY_TELEPHONE_NUMBER_1"],
  ["NMIS_MAIN_REC", "TELEPHON_NUMBERR"],
  ["NMIS_MAIN_REC", "ALTERNATIVE_TELEPHON_NUMBERR"],
  ["SUMMARY_OF_THE_QUESTIONNAIRE", "RESPONDENT_S_PHONE_NUMBER"],
  ["ADDRES_OF_HEAD_OFFICE", "TELEPHONE2"],
  ["CHANGED_ADDRESS_OF_THE_ESTABLISHMENT", "TELEPHON_NUMBERR_1"],
  ["CHANGED_ADDRESS_OF_THE_ESTABLISHMENT", "ALTERNATIVE_TELEPHON_NUMBERR_1"],
  ["HHINFO", "P_PHONE_NO_1"],
  ["HHINFO", "P_PHONE_NO_2"],
  ["HH_LISTING", "F0_PHONE_NO_1"],
  ["HH_LISTING", "F0_PHONE_NO_2"],
  ["UR_LISTING_REC", "F0_PHONE_NO_1"],
  ["UR_LISTING_REC", "F0_PHONE_NO_2"],
  ["COMFRAMEUPDAT", "FUQ15_PHONE1"],
  ["COMFRAMEUPDAT", "FUQ15_PHONE2"],
];

const SEARCH_EXPR =
  "(" + SEARCH_PATHS.map(([a, b]) => `COALESCE(answers->'${a}'->>'${b}', '')`).join(" || ' ' || ") + ")";

module.exports = { SEARCH_PATHS, SEARCH_EXPR };
