import { createClient } from "../adapters/client.js";
import { BASE, NCLT_HEADERS } from "../adapters/headers.js";
import { initSession } from "../adapters/session.js";
import { mapPartyListRow } from "../mappers/mapPartyListRow.js";

export const fetchByPartyName = async (req, res) => {
  const client = createClient();

  try {
    const {
      bench_id,
      party_name,
      case_year,
      party_type = "0",     // "P" or "R"
      case_status = "0",    // "P" pending / "D" disposed / "0" all
      search_type = "E"     // "E" exact / "W" wrap
    } = req.body || {};

    if (!bench_id) {
      return res.status(400).json({
        error: "bench_id is required"
      });
    }

    if (!party_name) {
      return res.status(400).json({
        error: "party_name is required"
      });
    }

    await initSession(client);

    const payload = {
      wayofselection: "partyname",

      i_bench_id: "0",
      filing_no: "",
      i_bench_id_case_no: "0",
      i_case_type_caseno: "0",
      i_case_year_caseno: "0",
      case_no: "",

      i_adv_search: "E",
      i_bench_id_lawyer: "0",
      party_lawer_name: "",
      i_case_year_lawyer: "0",
      bar_council_advocate: "",

      i_bench_id_party: String(bench_id),
      i_case_year_party: String(case_year || "0"),
      i_party_search: search_type === "W" ? "W" : "E",

      party_name_party: String(party_name).trim(),
      party_type_party: party_type,  // "P" / "R" / "0"
      status_party: case_status      // "P" / "D" / "0"
    };

    const resp = await client.post(
      `${BASE}/caseHistoryoptional.drt`,
      payload,
      {
        headers: NCLT_HEADERS,
        timeout: 600000
      }
    );

    const data = resp.data;

    const rows = Array.isArray(data?.mainpanellist)
      ? data.mainpanellist.map(mapPartyListRow)
      : [];

    return res.status(200).json({
      count: rows.length,
      results: rows
    });

  } catch (err) {
    return res.status(500).json({
      error: "Internal server error",
      message: err?.message || "Unknown error"
    });
  }
};