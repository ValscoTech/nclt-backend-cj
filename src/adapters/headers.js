export const BASE = "https://efiling.nclt.gov.in";
export const REFERER = `${BASE}/casehistorybeforeloginmenutrue.drt`;

export const NCLT_HEADERS = {
  "Content-Type": "application/json;charset=UTF-8",
  Accept: "application/json, text/plain, */*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: REFERER,
  Origin: BASE,
  "X-Requested-With": "XMLHttpRequest",
};
