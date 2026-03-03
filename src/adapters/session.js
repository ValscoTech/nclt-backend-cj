import { REFERER, NCLT_HEADERS } from "./headers.js";

export const initSession = async (client) => {
  // This establishes cookies/session like a browser visit
  await client.get(REFERER, { headers: { ...NCLT_HEADERS, Accept: "*/*" } });
};
