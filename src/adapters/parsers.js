export const mapCinListRow = (x) => ({
  filing_no: x?.filing_no || null,
  case_no: x?.caseNo1 || x?.case_no || null,
  case_type_desc_cis: x?.case_type_desc_cis || null,

  // Party metadata shown in portal table
  partyFlag: x?.partyFlag || null, // P / R
  partySerialNo: x?.partySerialNo || null,

  case_title1: x?.case_title1 || null,
  case_title2: x?.case_title2 || null,

  bench_location_name: x?.bench_location_name || null,
  court_no: x?.court_no || null,

  date_of_filing: x?.date_of_filing || null,
  regis_date: x?.regis_date || null,
  next_list_date: x?.next_list_date || null,
  disposal_date: x?.disposal_date || null,

  // status codes are sometimes P/D
  case_status: x?.case_status || null,

  // sometimes present
  allhearing: x?.allhearing ?? null,
  effhearing: x?.effhearing ?? null,

  cinNo: x?.cinNo || null,
});
