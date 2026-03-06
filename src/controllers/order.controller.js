import { createClient } from "../adapters/client.js";
import { BASE, NCLT_HEADERS } from "../adapters/headers.js";
import { initSession } from "../adapters/session.js";

export const downloadOrder = async (req, res) => {
  const client = createClient();

  try {
    const encPath = String(req.query.encPath || "").trim();

    if (!encPath) {
      return res.status(400).json({ error: "encPath is required" });
    }

    await initSession(client);

    const resp = await client.get(`${BASE}/ordersview.drt`, {
      headers: {
        ...NCLT_HEADERS,
        Accept: "application/pdf",
      },
      params: {
        path: encPath,
      },
      responseType: "arraybuffer",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=order.pdf");

    return res.send(resp.data);

  } catch (err) {
    console.log("ORDER DOWNLOAD ERROR", err.message);

    return res.status(500).json({
      error: "Failed to download order",
      message: err.message,
    });
  }
};