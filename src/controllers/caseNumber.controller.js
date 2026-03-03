import { createClient } from "../adapters/client.js";
import { BASE, NCLT_HEADERS } from "../adapters/headers.js";
import { initSession } from "../adapters/session.js";
import { mapCaseNumberRow } from "../mappers/mapCaseNumberRow.js";

export const fetchByCaseNumber = async (req, res) => {
  const client = createClient();

  try {
    const { bench_id, case_type_id, case_no, case_year } = req.body || {};

    if (!bench_id || !case_type_id || !case_no || !case_year) {
      return res.status(400).json({
        error: "bench_id, case_type_id, case_no, case_year are required",
      });
    }

    await initSession(client);

    const payload = {
      wayofselection: "casenumber",

      i_bench_id: "0",
      i_bench_id_case_no: String(bench_id),
      i_bench_id_lawyer: "0",
      i_bench_id_party: "0",

      i_case_type_caseno: String(case_type_id),

      case_no: String(case_no),
      filing_no: "",

      i_case_year_caseno: String(case_year),
      i_case_year_lawyer: "0",
      i_case_year_party: "0",

      bar_council_advocate: "",
      i_adv_search: "E",

      i_party_search: "E",
      party_name_party: "",
      party_lawer_name: "",
      party_type_party: "0",
      status_party: "0",
    };

    const resp = await client.post(
      `${BASE}/caseHistoryoptional.drt`,
      payload,
      { headers: NCLT_HEADERS }
    );

    const data = resp.data;

    const rows = Array.isArray(data?.mainpanellist)
      ? data.mainpanellist.map(mapCaseNumberRow)
      : [];

    return res.status(200).json({
      count: rows.length,
      results: rows,
    });

  } catch (err) {
    return res.status(500).json({
      error: "Internal server error",
      message: err?.message || "Unknown error",
    });
  }
};