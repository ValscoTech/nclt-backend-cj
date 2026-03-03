import { createClient } from "../adapters/client.js";
import { BASE, NCLT_HEADERS } from "../adapters/headers.js";
import { initSession } from "../adapters/session.js";
import { safeJson } from "../utils/safeJson.js";
import { isValidCINFormat } from "../utils/validators.js";
import { mapCinListRow } from "../adapters/parsers.js";

const getCompanyNameForCIN = async (client, cin) => {
  // Portal keyup uses: { cin: cinNumber }
  const resp = await client.post(
    `${BASE}/getCompanyName.drt`,
    { cin },
    { headers: NCLT_HEADERS },
  );

  return safeJson(resp.data)?.companyName ?? null;
};

const fetchCaseListByCIN = async (client, cin) => {
  // Portal search uses: { cin_number: ... }
  const resp = await client.post(
    `${BASE}/caseHistoryoptionalCIN.drt`,
    { cin_number: cin },
    { headers: NCLT_HEADERS },
  );

  const data = safeJson(resp.data);
  return Array.isArray(data?.byCinNumber) ? data.byCinNumber : [];
};

export const fetchByCIN = async (req, res) => {
  const client = createClient();

  try {
    const cin = (req.body?.cin || req.body?.cin_number || "")
      .trim()
      .toUpperCase();

    if (!cin) return res.status(400).json({ error: "cin is required" });

    if (!isValidCINFormat(cin)) {
      return res.status(400).json({
        error: "Invalid CIN format",
        hint: "Format: 1 letter + 5 digits + 2 letters + 4 digits + 3 letters + 6 digits (total 21)",
      });
    }

    await initSession(client);

    const companyName = await getCompanyNameForCIN(client, cin);

    if (!companyName || companyName === "Please enter a valid CIN number") {
      return res.status(400).json({
        error: "Please enter a valid CIN number",
        server_msg: companyName,
      });
    }

    const rows = await fetchCaseListByCIN(client, cin);

    // ✅ IMPORTANT: list-only, no details prefetch
    return res.status(200).json({
      cin,
      companyName,
      byCinNumber: rows.map(mapCinListRow),
    });
  } catch (err) {
    return res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  }
};
