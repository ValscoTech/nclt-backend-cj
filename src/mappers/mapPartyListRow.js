export const mapPartyListRow = (obj = {}, idx = 0) => ({
  sNo: idx + 1,
  filingNo: obj.filing_no ?? null,
  caseType: obj.case_type_desc_cis ?? null,
  caseNo: obj.case_no ?? null,
  caseTitle1: obj.case_title1 ?? null,
  caseTitle2: obj.case_title2 ?? null,
  benchLocation: obj.bench_location_name ?? null,
  courtNo: obj.court_no ?? null,
  mainCaseFilingNo: obj.main_case_fno ?? null,
  filingDate: obj.date_of_filing ?? null,
  registrationDate: obj.regis_date ?? null,
  nextListingDate: obj.next_list_date ?? null,
  disposalDate: obj.disposal_date ?? null,
  status: obj.status ?? null, // Pending / Dispose / etc
  caseStage: obj.caseStageMainPanel ?? null,
  allHearings: obj.allhearing ?? null,
  effectiveHearings: obj.effhearing ?? null,
});
