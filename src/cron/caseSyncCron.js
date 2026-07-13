import { db, auth, admin } from "../config/firebaseAdminConfig.js";
import { createClient } from "../adapters/client.js";
import { BASE, NCLT_HEADERS } from "../adapters/headers.js";
import { initSession } from "../adapters/session.js";
import { safeJson } from "../utils/safeJson.js";
import { extractModalData } from "../utils/extractModalData.js";
import { syncNcltOrders, notifyNewOrders } from "./order.sync.helper.js";

const SESSION_RETRY_ATTEMPTS = 3;
const SESSION_RETRY_DELAY_MS = 3000;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

      const { payload: updatePayload, shouldUpdateHearingDate } = buildUpdatePayload(newData, ncltCase);

      await db
          .collection(ncltCase.collection)
          .doc(ncltCase.id)
          .set(updatePayload, { merge: true });

      // Sync any new orders to the orders sub-collection
      const proceedingDetails = newData.proceedingDetails || [];
      let newOrders = [];
      try {
        newOrders = await syncNcltOrders(ncltCase.id, proceedingDetails, ncltCase.collection);
      } catch (err) {
        console.error(`[OrderSync] Failed for case ${ncltCase.id}:`, err);
      }

      if (newOrders.length > 0) {
        notifyNewOrders(ncltCase.owner, ncltCase.id, newOrders, ncltCase)
          .catch(err => console.error(`[OrderNotify] Failed for case ${ncltCase.id}:`, err));
      }

      // Notify only if date actually changed to a valid new date
      if (shouldUpdateHearingDate && updatePayload.nextHearingDate !== "N/A") {
          createNotification(ncltCase.owner, ncltCase.id, updatePayload.nextHearingDate, ncltCase)
              .catch(err => console.error(`Notification creation failed for case ${ncltCase.id}:`, err));
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

  const existingDate = ncltCase.nextHearingDate ? ncltCase.nextHearingDate : "N/A";
  const rawNextHearingDate = parseNextHearingDate(currentDetails?.case_stage);
  const newDateParsed = rawNextHearingDate ? rawNextHearingDate.replace(/-/g, "/") : "N/A";

  let shouldUpdateHearingDate = true;
  if (existingDate !== "N/A" && newDateParsed !== "N/A") {
      shouldUpdateHearingDate = toDate(newDateParsed) > toDate(existingDate);
  }

  const nextHearingDate = shouldUpdateHearingDate ? newDateParsed : existingDate;

  const previousHearingDate = proceedingDetails?.[0]?.listing_date
    ? formatDate(proceedingDetails[0].listing_date)
    : ncltCase.previousHearingDate;

  const caseHistory = (proceedingDetails || []).map((p) => ({
    causeListType: "NCLT",
    judge: "—",
    businessOnDate: formatDate(p.order_upload_datetime),
    hearingDate: formatDate(p.listing_date),
    purpose: p.listing_purpose || p.next_listing_purpose || "Listing / Order",
  }));

  const petitioner = partyDetails?.find((p) => p.party_type?.startsWith("P"));
  const respondent = partyDetails?.find((p) => p.party_type?.startsWith("R"));

  const petitionerAdvocate = petitioner?.advocate_name || ncltCase.petitionerAdvocate || "";
  const respondentAdvocate =
    respondent?.advocate_name && respondent.advocate_name !== "NA"
      ? respondent.advocate_name
      : ncltCase.respondentAdvocate || "";

  const payload = {
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

  return { payload, shouldUpdateHearingDate };  // return both
}

const toDate = (str) => {
  if (!str) return null;
  const parts = str.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  return new Date(`${yyyy}-${mm}-${dd}`);
};

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
      //.where("owner", "==", "hhXchcgjrtP3brr1AxQMJiVbbMV2")
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
  const match = String(caseStage).match(/(\d{2}-\d{2}-\d{4})/);
  return match ? match[1] : null;
}

// "08-04-2026" or "08-04-2026  12:19:19" → "08/04/2026" or "08/04/2026  12:19:19"
function formatDate(raw) {
  if (!raw) return "";
  return String(raw).replace(/-/g, "/");
}

// "18-05-2026" (DD-MM-YYYY) → Date object
function parseDateDMY(dateStr) {
  if (!dateStr) return null;
  const [day, month, year] = dateStr.split("/").map(Number); // ← match dd/mm/yyyy
  return new Date(year, month - 1, day);
}

async function createNotification(ownerId, caseId, nextHearingDate, ncltCase) {
  if (!ownerId) {
    console.log("No ownerId provided for case:", caseId);
    return;
  }

  try {
    const lawyerDoc = await db.collection("lawyers").doc(ownerId).get();
    const clientDoc = await db.collection("client").doc(ownerId).get();

    if (!lawyerDoc.exists && !clientDoc.exists) {
      console.log("Owner not found for case:", caseId);
      return;
    }

    const ownerDoc = lawyerDoc.exists ? lawyerDoc : clientDoc;
    const fcmTokens = ownerDoc.data().fcmTokens || [];

    const hearingDate = parseDateDMY(nextHearingDate);
    if (!hearingDate) return;

    const reminder1 = new Date(hearingDate);
    reminder1.setHours(8, 0, 0, 0);

    const reminder2 = new Date(hearingDate);
    reminder2.setHours(18, 0, 0, 0);

    // Store notification in DB
    const event1 = await db.collection("eventReminders").add({
      "caseId": caseId,
      "caseNo": `${ncltCase.caseNo}`,
      "createdAt": new Date(),
      "eventTitle": `${ncltCase.petitionerName} VS ${ncltCase.respondentName}`,
      "recipientId": ownerId,
      "reminderTime": reminder1,
      "scheduledBy": ownerId,
      "status": "scheduled"
    });

    const event2 = await db.collection("eventReminders").add({
      "caseId": caseId,
      "caseNo": `${ncltCase.caseNo}`,
      "createdAt": new Date(),
      "eventTitle": `Update Next Hearing: ${ncltCase.petitionerName} VS ${ncltCase.respondentName}`,
      "recipientId": ownerId,
      "reminderTime": reminder2,
      "scheduledBy": ownerId,
      "status": "scheduled"
    });

    console.log(event1.id + " " + event2.id);
    console.log(`Notification created for case: ${caseId}, owner: ${ownerId}`);
  } catch (err) {
    console.error("Error creating notification:", err);
  }
}

/*async function sendDueNotifications() {
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
}*/

function normalizeFcmTokens(rawTokens) {
  if (!Array.isArray(rawTokens)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of rawTokens) {
    const t = typeof entry === "string" ? entry : entry?.token;
    if (!t || typeof t !== "string") continue;
    if (seen.has(t)) continue;
    seen.add(t);
    result.push(t);
  }
  return result;
}

function withPlatformConfig(message) {
  return {
    ...message,
    apns: {
      headers: { "apns-priority": "10" },
      payload: { aps: { sound: "default", badge: 1 } },
      ...(message.apns || {}),
    },
    android: {
      priority: "high",
      notification: {
        channelId: "high_importance_channel",
        sound: "notification_sound",
      },
      ...(message.android || {}),
    },
  };
}

/*async function sendMorningNotifications() {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    let reminders = await db.collection("eventReminders")
                          .where("nextHearingDate", ">=", startOfDay)
                          .where("nextHearingDate", "<=", endOfDay)
                          .get();


    if (reminders.empty) {
      console.log("No notifications found for today");
      return;
    }

    for (let reminderDoc of reminders.docs) {
      let reminder = reminderDoc.data();

      // Transaction: atomically claim the reminder
      let claimed = false;
      try {
        await db.runTransaction(async (t) => {
          const fresh = await t.get(reminderDoc.ref);

          if (fresh.data().event1.reminderSent) {
            claimed = false; // already claimed by another cron
            return;
          }

          // Mark as sent atomically so no other cron can claim it
          t.update(reminderDoc.ref, { "event1.reminderSent": true, sentAt: new Date() });
          claimed = true;
        });
      } catch (err) {
        console.error("Transaction failed for doc:", reminderDoc.id, err);
        continue;
      }

      if (!claimed) {
        console.log("Reminder for case " + reminder.caseId + " already sent.");
        continue;
      }
      // End of transaction
      try {
        let ownerSnap = await db.collection("lawyers").doc(reminder.userId).get();
        if (!ownerSnap.exists) {
          ownerSnap = await db.collection("client").doc(reminder.userId).get();
        }
        const tokens = ownerSnap.exists
          ? normalizeFcmTokens(ownerSnap.data().fcmTokens)
          : normalizeFcmTokens(reminder.fcmTokens);

        if (!tokens.length) {
          console.log(`No FCM tokens for doc: ${reminderDoc.id}`);
          continue;
        }

        const notification = {
          title: reminder.event1.description || "Hearing Reminder",
          body: reminder.event1.title || "You have an upcoming hearing",
        };

        const messages = tokens.map((token) =>
          withPlatformConfig({ token, notification })
        );

      
        const response = await admin.messaging().sendEach(messages);
        console.log(
          `Notification sent for case ${reminder.caseId} | success: ${response.successCount}, failure: ${response.failureCount}`
        );
        if (response.failureCount > 0) {
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              console.error(
                `FCM failure for doc ${reminderDoc.id} token ...${tokens[idx].slice(-6)}:`,
                resp.error?.code,
                resp.error?.message
              );
            }
          });
        }

        // Note: we already set reminderSent: true in the transaction above
        // so we don't update it again here

        const eventNotification = {
          "userId": reminder.userId,
          "caseId": reminder.caseId
        };
        await db.collection("notificationLogs").add(eventNotification);
      } catch (err) {
        // FCM failed — roll back the flag so another cron can retry
        await reminderDoc.ref.update({ reminderSent: false, sentAt: null });
        console.error("FCM send error for doc:", reminderDoc.id, err);
      }
    }
  } catch (err) {
    console.error("Error in sendDueNotifications:", err);
    throw err;
  }
}

async function sendEveningNotifications() {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    let reminders = await db.collection("eventReminders")
                          .where("nextHearingDate", ">=", startOfDay)
                          .where("nextHearingDate", "<=", endOfDay)
                          .get();


    if (reminders.empty) {
      console.log("No notifications found for today");
      return;
    }

    for (let reminderDoc of reminders.docs) {
      let reminder = reminderDoc.data();

      // Transaction: atomically claim the reminder
      let claimed = false;
      try {
        await db.runTransaction(async (t) => {
          const fresh = await t.get(reminderDoc.ref);

          if (fresh.data().event2.reminderSent) {
            claimed = false; // already claimed by another cron
            return;
          }

          // Mark as sent atomically so no other cron can claim it
          t.update(reminderDoc.ref, { "event2.reminderSent": true, sentAt: new Date() });
          claimed = true;
        });
      } catch (err) {
        console.error("Transaction failed for doc:", reminderDoc.id, err);
        continue;
      }

      if (!claimed) {
        console.log("Reminder for case " + reminder.caseId + " already sent.");
        continue;
      }
      // End of transaction

      let ownerSnap = await db.collection("lawyers").doc(reminder.userId).get();
      if (!ownerSnap.exists) {
        ownerSnap = await db.collection("client").doc(reminder.userId).get();
      }
      const tokens = ownerSnap.exists
        ? normalizeFcmTokens(ownerSnap.data().fcmTokens)
        : normalizeFcmTokens(reminder.fcmTokens);

      if (!tokens.length) {
        console.log(`No FCM tokens for doc: ${reminderDoc.id}`);
        continue;
      }

      const notification = {
        title: reminder.event2.eventReminders.eventTitle || "Hearing Reminder",
        body: reminder.event2.title || "You have an upcoming hearing",
      };

      const messages = tokens.map((token) =>
        withPlatformConfig({ token, notification })
      );

      try {
        const response = await admin.messaging().sendEach(messages);
        console.log(
          `Notification sent for case ${reminder.caseId} | success: ${response.successCount}, failure: ${response.failureCount}`
        );
        if (response.failureCount > 0) {
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              console.error(
                `FCM failure for doc ${reminderDoc.id} token ...${tokens[idx].slice(-6)}:`,
                resp.error?.code,
                resp.error?.message
              );
            }
          });
        }

        // Note: we already set reminderSent: true in the transaction above
        // so we don't update it again here

        const eventNotification = {
          "userId": reminder.userId,
          "caseId": reminder.caseId
        };
        await db.collection("notificationLogs").add(eventNotification);
      } catch (err) {
        // FCM failed — roll back the flag so another cron can retry
        await reminderDoc.ref.update({ reminderSent: false, sentAt: null });
        console.error("FCM send error for doc:", reminderDoc.id, err);
      }
    }
  } catch (err) {
    console.error("Error in sendDueNotifications:", err);
    throw err;
  }
}*/

export { caseSyncCronJob,
  //sendDueNotifications 
};