const pickFirst = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

const cleanText = (v) => {
  if (v === undefined || v === null) return null;
  return String(v).trim() || null;
};

// Portal sometimes has "YES</br>24-03-2022"
const stripHtmlBreaks = (v) =>
  cleanText(v)
    ?.replace(/<\/?br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim() ?? null;

export const extractModalData = (data, { proceedingsLimit = null } = {}) => {
  // 1) header fields can be derived from multiple places
  const regRow =
    pickFirst(data?.isregistered) ||
    pickFirst(data?.allfinalstatuslist) ||
    pickFirst(data?.isallocatedbyregistrarlist);

  const finalRow = pickFirst(data?.allfinalstatuslist);
  const parties = Array.isArray(data?.partydetailslist)
    ? data.partydetailslist
    : [];
  const petitioner = parties.find((p) =>
    String(p?.party_type || "").startsWith("P"),
  );
  const respondent = parties.find((p) =>
    String(p?.party_type || "").startsWith("R"),
  );

  const filingNo =
    cleanText(regRow?.filing_no) || cleanText(finalRow?.filing_no) || null;
  const regNo =
    cleanText(regRow?.case_no) ||
    cleanText(regRow?.caseNo1) ||
    cleanText(finalRow?.case_no) ||
    null;

  const partyNameFromTitles =
    cleanText(regRow?.case_title1) && cleanText(regRow?.case_title2)
      ? `${cleanText(regRow?.case_title1)} VS ${cleanText(regRow?.case_title2)}`
      : null;

  const partyNameFromPartyList =
    cleanText(petitioner?.party_name) && cleanText(respondent?.party_name)
      ? `${cleanText(petitioner?.party_name)} VS ${cleanText(respondent?.party_name)}`
      : null;

  const allHearings =
    cleanText(pickFirst(data?.allproceedingdtls)?.allhearing) ||
    cleanText(regRow?.allhearing) ||
    null;

  const effHearings =
    cleanText(pickFirst(data?.allproceedingdtls)?.effhearing) ||
    cleanText(regRow?.effhearing) ||
    null;

  // 2) Current Details table = mainly from allfinalstatuslist (it matches your modal row)
  const currentDetails = finalRow
    ? {
        filing_date: cleanText(finalRow?.date_of_filing),
        case_type:
          cleanText(finalRow?.case_type) ||
          cleanText(finalRow?.case_type_desc_cis),
        case_filed_by: cleanText(finalRow?.case_filed_by),
        defect_issued_date: cleanText(finalRow?.defective_date),
        refiled_date: cleanText(finalRow?.refiled_date),
        defect_free: stripHtmlBreaks(finalRow?.defect_free),
        registration_date: cleanText(finalRow?.regis_date),
        court_no: cleanText(finalRow?.court_no),
        bench_nature: cleanText(finalRow?.bench_nature_descr),
        first_listing_date: cleanText(finalRow?.listing_date),
        case_stage: cleanText(finalRow?.current_status),
      }
    : null;

  // 3) Defective dates table
  const defectiveDates = (
    Array.isArray(data?.Case_Defective_Dates) ? data.Case_Defective_Dates : []
  )
    .map((x, idx) => ({
      sno: idx + 1,
      defective_date: cleanText(x?.defective_date),
    }))
    .filter((x) => x.defective_date);

  // 4) Party details table
  const partyDetails = parties.map((x, idx) => ({
    sno: idx + 1,
    party_type: cleanText(x?.party_type),
    party_name: cleanText(x?.party_name),
    party_email: cleanText(x?.party_email),
    party_mobile: cleanText(x?.party_mobile),
    advocate_name: cleanText(x?.party_lawer_name),
    full_party_email: cleanText(x?.full_party_email),
    full_party_mobile: cleanText(x?.full_party_mobile),
  }));

  // 5) Application details table (IA rows)
  const applicationDetails = (
    Array.isArray(data?.mainFilnowithIaNoList) ? data.mainFilnowithIaNoList : []
  ).map((x, idx) => ({
    sno: idx + 1,
    filing_no: cleanText(x?.filing_no),
    case_type: cleanText(x?.case_type_desc_cis),
    case_title1: cleanText(x?.case_title1),
    case_title2: cleanText(x?.case_title2),
    bench_location: cleanText(x?.bench_location_name),
    court_no: cleanText(x?.court_no),
    application_no: cleanText(x?.case_no),
    filing_date: cleanText(x?.date_of_filing),
    registration_date: cleanText(x?.regis_date),
    next_list_or_dispose_date:
      cleanText(x?.next_list_date) || cleanText(x?.disposal_date),
    case_status: cleanText(x?.status),
    main_case_fno: cleanText(x?.main_case_fno),
  }));

  // 6) Disposed details table
  const disposedDetails = (
    Array.isArray(data?.disposedetailslist) ? data.disposedetailslist : []
  )
    .map((x, idx) => ({
      sno: idx + 1,
      disposal_date: cleanText(x?.disposal_date),
      disposed_nature: cleanText(x?.action_type),
    }))
    .filter((x) => x.disposal_date || x.disposed_nature);

  // 7) Proceeding details table (this one can be large → optional limit)
  let proceedingDetails = Array.isArray(data?.allproceedingdtls)
    ? data.allproceedingdtls
    : [];
  if (Number.isFinite(proceedingsLimit) && proceedingsLimit > 0) {
    proceedingDetails = proceedingDetails.slice(0, proceedingsLimit);
  }

  proceedingDetails = proceedingDetails.map((x, idx) => ({
    sno: idx + 1,
    bench_location: cleanText(x?.bench_location_name),
    court_no: cleanText(x?.court_no),
    listing_date: cleanText(x?.listing_date),
    listing_purpose: cleanText(x?.purpose),
    action_taken: cleanText(x?.today_action),
    next_list_or_dispose_date: cleanText(x?.next_list_date),
    next_listing_purpose: cleanText(x?.next_listing_purpose),
    order_upload_datetime: cleanText(x?.order_upload_date),
    status: cleanText(x?.case_status),
    order_name: cleanText(x?.path_descr),
    encPath: cleanText(x?.encPath), // for submitOrders()
  }));

  // 8) NCLAT mapping table
  const nclatDetails = Array.isArray(data?.nclatmappinglist)
    ? data.nclatmappinglist
    : [];

  return {
    header: {
      filingNo,
      regNo,
      partyName: partyNameFromPartyList || partyNameFromTitles || null,
      allHearings,
      effHearings,
    },
    currentDetails,
    defectiveDates,
    partyDetails,
    applicationDetails,
    disposedDetails,
    proceedingDetails,
    nclatDetails,
  };
};
