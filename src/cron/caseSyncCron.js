import { db, auth, admin } from "../config/firebaseAdminConfig.js"; 
import { createClient } from "../adapters/client.js";
import { BASE, NCLT_HEADERS } from "../adapters/headers.js";
import { initSession } from "../adapters/session.js";
import { safeJson } from "../utils/safeJson.js";
import { extractModalData } from "../utils/extractModalData.js";

const SESSION_RETRY_ATTEMPTS = 3;
const SESSION_RETRY_DELAY_MS = 3000;

async function caseSyncCronJob() {

  const client = createClient();
  const sessionReady = await initSessionWithRetry(client);
 
  if (!sessionReady) {
    console.error("Session init failed after all retries. Aborting cron run.");
    return;
  }
  const dbCases = await getNcltCasesFromDb();
 
  for (const ncltCase of dbCases) {
    try {
      const filingNo = ncltCase.filingNo;
      const newData = await getNewData(client, filingNo);
 
      if (!newData || newData.error) {
        console.error(`Failed to fetch new data for case ${ncltCase.id}:`, newData?.message);
        continue;
      }
 
      const updatePayload = buildUpdatePayload(newData, ncltCase);
 
      await db
        .collection(ncltCase.collection)
        .doc(ncltCase.id)
        .set(updatePayload, { merge: true });

      // Fire notification if next hearing date changed
      const nextHearingDate = updatePayload.nextHearingDate;
      if (nextHearingDate && nextHearingDate !== ncltCase.nextHearingDate) {
        await createNotification(ncltCase.owner, ncltCase.id, nextHearingDate);
      }
 
      console.log(`Completed NCLT case update for case: ${ncltCase.id} at ${new Date()}`);
    } catch (err) {
      console.error(`Error updating NCLT case ${ncltCase.id}:`, err.message);
      // continue to next case
    }
  }
}

async function initSessionWithRetry(client) {
  for (let attempt = 1; attempt <= SESSION_RETRY_ATTEMPTS; attempt++) {
    try {
      await initSession(client);
      console.log(`Session initialised on attempt ${attempt}`);
      return true;
    } catch (err) {
      console.warn(`Session init attempt ${attempt} failed: ${err.message}`);
      if (attempt < SESSION_RETRY_ATTEMPTS) {
        await delay(SESSION_RETRY_DELAY_MS);
      }
    }
  }
  return false;
}
 
function buildUpdatePayload(newData, ncltCase) {
  const {
    header,
    currentDetails,
    partyDetails,
    applicationDetails,
    disposedDetails,
    proceedingDetails,
    nclatDetails,
    defectiveDates,
  } = newData;
 
  // Extract next hearing date from case_stage
  // e.g. "Case Next List Date: 18-05-2026" → "18-05-2026"
  const rawNextHearingDate = parseNextHearingDate(currentDetails?.case_stage);
    const nextHearingDate = rawNextHearingDate
    ? rawNextHearingDate.replace(/-/g, "/")
    : ncltCase.nextHearingDate;
 
  // Most recent proceeding = index 0 (API returns newest first)
  const previousHearingDate = proceedingDetails?.[0]?.listing_date
  ? formatDate(proceedingDetails[0].listing_date)
  : ncltCase.previousHearingDate;
 
  // Build caseHistory in the same shape as the DB
  const caseHistory = (proceedingDetails || []).map((p) => ({
    causeListType: "NCLT",
    judge: "—",
    businessOnDate: formatDate(p.order_upload_datetime),
    hearingDate: formatDate(p.listing_date),
    purpose: p.listing_purpose || p.next_listing_purpose || "Listing / Order",
  }));
 
  // Advocates from partyDetails (P = petitioner, R = respondent)
  const petitioner = partyDetails?.find((p) => p.party_type?.startsWith("P"));
  const respondent = partyDetails?.find((p) => p.party_type?.startsWith("R"));
 
  const petitionerAdvocate = petitioner?.advocate_name || ncltCase.petitionerAdvocate || "";
  const respondentAdvocate =
    respondent?.advocate_name && respondent.advocate_name !== "NA"
      ? respondent.advocate_name
      : ncltCase.respondentAdvocate || "";
 
  return {
    previousHearingDate,
    nextHearingDate,
 
    petitionerAdvocate,
    respondentAdvocate,
 
    ncltProceedingDetails: proceedingDetails || ncltCase.ncltProceedingDetails || [],
    caseHistory,
 
    rawNcltData: {
      listRow: {
        filingNumber: header?.filingNo || ncltCase.filingNo,
        caseNo: header?.regNo || ncltCase.caseNo,
        parties: header?.partyName || `${ncltCase.petitionerName} VS ${ncltCase.respondentName}`,
        filingDate: currentDetails?.filing_date || ncltCase.caseFiledDate,
        statusText: ncltCase.status || "Pending",
        caseStage: currentDetails?.case_stage || "",
      },
      fullDetails: {
        header: header || {},
        currentDetails: currentDetails || {},
        defectiveDates: defectiveDates || [],
        partyDetails: partyDetails || [],
        applicationDetails: applicationDetails || [],
        disposedDetails: disposedDetails || [],
        proceedingDetails: proceedingDetails || [],
        nclatDetails: nclatDetails || [],
      },
    },
 
    refreshedAt: new Date(),
  };
}

async function getNewData(client, filingNoInput) {
    
      try {
        const filingNo = String(filingNoInput || "").trim();
        if (!filingNo)
          return;
        
        const resp = await client.get(`${BASE}/caseHistoryalldetails.drt`, {
          headers: { ...NCLT_HEADERS, Accept: "*/*" },
          params: { filing_no: filingNo, flagIA: "false" },
        });
    
        const data = safeJson(resp.data);
    
        const modal = extractModalData(data, {
          proceedingsLimit: 200,
        });
    
        return modal;
      } catch (err) {
        return {
          error: "Internal server error",
          message: err.message,
        };
      }
}

async function getNcltCasesFromDb() {
  try {
    const casesRef = db.collection("pending");

    // Admin SDK query
    const querySnapshot = await casesRef
      .where("courtName", "==", "NCLT")
      .get();

    const cases = [];
    querySnapshot.forEach((doc) => {
      cases.push({ id: doc.id, ...doc.data(), collection: "pending" });
    });
    return cases;
  } catch (err) {
    console.error("Error fetching cases:", err);
    return [];
  }
}

function parseNextHearingDate(caseStage) {
  if (!caseStage) return null;
  const match = caseStage.match(/(\d{2}-\d{2}-\d{4})/);
  return match ? match[1] : null;
}
 
// "08-04-2026" or "08-04-2026  12:19:19" → "08/04/2026" or "08/04/2026  12:19:19"
function formatDate(raw) {
  if (!raw) return "";
  return raw.replace(/-/g, "/");
}
 
// "18-05-2026" (DD-MM-YYYY) → Date object
function parseDateDMY(dateStr) {
  if (!dateStr) return null;
  const [day, month, year] = dateStr.split("/").map(Number); // ← match dd/mm/yyyy
  return new Date(year, month - 1, day);
}
 
async function createNotification(ownerId, caseId, nextHearingDate) {
  try {
    const lawyerDoc = await db.collection("lawyers").doc(ownerId).get();
    const clientDoc = await db.collection("clients").doc(ownerId).get();
 
    if (!lawyerDoc.exists && !clientDoc.exists) {
      console.log("Owner not found for case:", caseId);
      return;
    }
 
    const ownerDoc = lawyerDoc.exists ? lawyerDoc : clientDoc;
    const fcmTokens = ownerDoc.data().fcmTokens || [];
 
    const hearingDate = parseDateDMY(nextHearingDate);
    if (!hearingDate) return;
 
    const reminder1 = new Date(hearingDate.getTime() - 24 * 60 * 60 * 1000);
    reminder1.setHours(8, 0, 0, 0);
 
    const reminder2 = new Date(hearingDate);
    reminder2.setHours(8, 0, 0, 0);
 
    await db.collection("notificationLogs").add({
      userId: ownerId,
      caseId,
      title: "Hearing Reminder",
      message: `Your hearing is scheduled for ${nextHearingDate}`,
      nextHearingDate: hearingDate,
      reminder1,
      reminder2,
      fcmTokens,
      reminder1Sent: false,
      reminder2Sent: false,
      createdAt: new Date(),
    });
 
    console.log(`Notification created for case: ${caseId}, owner: ${ownerId}`);
  } catch (err) {
    console.error("Error creating notification:", err);
  }
}
 
async function sendDueNotifications() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
 
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
 
    const endOfTomorrow = new Date(tomorrow);
    endOfTomorrow.setHours(23, 59, 59, 999);
 
    console.log("Checking notifications between:", today, "and", endOfTomorrow);
 
    const snapshot = await db
      .collection("notificationLogs")
      .where("nextHearingDate", ">=", today)
      .where("nextHearingDate", "<=", endOfTomorrow)
      .get();
 
    if (snapshot.empty) {
      console.log("No notifications found for today/tomorrow");
      return;
    }
 
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const tokens = data.fcmTokens || [];
 
      if (!tokens.length) {
        console.log(`No FCM tokens for doc: ${doc.id}`);
        continue;
      }
 
      const message = {
        notification: {
          title: data.title || "Hearing Reminder",
          body: data.message || "You have an upcoming hearing",
        },
        tokens,
      };
 
      try {
        const response = await admin.messaging().sendMulticast(message);
        console.log(
          `Notification sent for case ${data.caseId} | success: ${response.successCount}, failure: ${response.failureCount}`
        );
      } catch (err) {
        console.error("FCM send error for doc:", doc.id, err);
      }
    }
  } catch (err) {
    console.error("Error in sendDueNotifications:", err);
    throw err;
  }
}

export { caseSyncCronJob, sendDueNotifications };