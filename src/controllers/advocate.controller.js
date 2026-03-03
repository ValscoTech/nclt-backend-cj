import { createClient } from "../adapters/client.js";
import { BASE, NCLT_HEADERS } from "../adapters/headers.js";
import { initSession } from "../adapters/session.js";
import { mapCaseNumberRow } from "../mappers/mapCaseNumberRow.js";

export const fetchByAdvocate = async (req, res) => {
  const client = createClient();

  try {
    const {
      bench_id,
      advocate_name,
      case_year,
      search_type = "E", // default Exact
      bar_council_number = "",
    } = req.body || {};

    if (!bench_id || !advocate_name || !case_year) {
      return res.status(400).json({
        error: "bench_id, advocate_name and case_year are required",
      });
    }

    await initSession(client);

    const payload = {
      wayofselection: "advocatename",

      i_bench_id: "0",
      i_bench_id_case_no: "0",
      i_bench_id_lawyer: String(bench_id),
      i_bench_id_party: "0",

      i_case_type_caseno: "0",

      case_no: "",
      filing_no: "",

      i_case_year_caseno: "0",
      i_case_year_lawyer: String(case_year),
      i_case_year_party: "0",

      bar_council_advocate: String(bar_council_number),

      i_adv_search: search_type === "W" ? "W" : "E",

      i_party_search: "E",
      party_lawer_name: String(advocate_name),
      party_name_party: "",
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