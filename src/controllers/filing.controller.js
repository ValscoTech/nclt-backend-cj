import { createClient } from "../adapters/client.js";
import { BASE, NCLT_HEADERS } from "../adapters/headers.js";
import { initSession } from "../adapters/session.js";
import { safeJson } from "../utils/safeJson.js";
import { extractModalData } from "../utils/extractModalData.js"; // ✅ add this

export const fetchFilingPopup = async (req, res) => {
  const client = createClient();

  try {
    const filingNo = String(req.params.filingNo || "").trim();
    if (!filingNo)
      return res.status(400).json({ error: "filingNo is required" });

    await initSession(client);

    const resp = await client.get(`${BASE}/caseHistoryalldetails.drt`, {
      headers: { ...NCLT_HEADERS, Accept: "*/*" },
      params: { filing_no: filingNo, flagIA: "false" },
    });

    const data = safeJson(resp.data);

    const modal = extractModalData(data, {
      proceedingsLimit: 200,
    });

    return res.status(200).json(modal);
  } catch (err) {
    return res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  }
};
