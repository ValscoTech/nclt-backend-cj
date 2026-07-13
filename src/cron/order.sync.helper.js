import { db } from "../config/firebaseAdminConfig.js";

/**
 * Syncs NCLT orders to a Firestore sub-collection:
 *   pending/{caseId}/orders/{orderId}
 *
 * Only NEW orders are written — existing ones are skipped (no duplicates).
 * A row in proceedingDetails is considered an order only when its `encPath`
 * field is non-null/non-empty (i.e. there is an actual PDF attached).
 *
 * Doc ID: URL slug of encPath with non-alphanumeric chars replaced by "-"
 * e.g.  "ordersview-drt-path-abc123-pdf"
 *
 * @param {string} caseId            - Firestore pending case document ID
 * @param {Array}  proceedingDetails - Mapped rows from extractModalData()
 * @param {string} [collectionName]  - "pending" (default) or "disposed"
 * @returns {Promise<Array>}         - Array of newly written order docs (empty if none new)
 */
export async function syncNcltOrders(caseId, proceedingDetails, collectionName = "pending") {
  // Only rows that actually have a PDF attached
  const ordersWithPdf = (Array.isArray(proceedingDetails) ? proceedingDetails : [])
    .filter((row) => row.encPath && String(row.encPath).trim());

  if (ordersWithPdf.length === 0) {
    console.log(`[OrderSync] No orders with encPath found for case ${caseId}. Skipping.`);
    return [];
  }

  console.log(
    `[OrderSync] Starting order sync for case ${caseId}. ` +
    `${ordersWithPdf.length} proceeding row(s) have an order PDF.`
  );

  const ordersColRef = db.collection(collectionName).doc(caseId).collection("orders");

  // Fetch only IDs of already-saved orders (avoids downloading full docs)
  let existingOrderIds = new Set();
  try {
    const existingSnap = await ordersColRef.select().get();
    existingOrderIds = new Set(existingSnap.docs.map((doc) => doc.id));
  } catch (err) {
    console.error(`[OrderSync] Could not fetch existing order IDs for case ${caseId}:`, err);
    // Continue anyway — worst case we attempt to write and Firestore handles it
  }

  const newOrders = [];

  for (const row of ordersWithPdf) {
    // Build a deterministic, duplicate-safe document ID from the encPath slug
    const orderId = String(row.encPath)
      .split("/")
      .pop()
      .replace(/[^a-zA-Z0-9]/g, "-");

    if (existingOrderIds.has(orderId)) {
      continue; // Already in Firestore — skip
    }

    const orderDoc = {
      encPath:               String(row.encPath).trim(),
      order_name:            row.order_name            || "",
      order_date:            row.listing_date          || "",
      order_upload_datetime: row.order_upload_datetime || "",
      detectedAt:            new Date(),
    };

    try {
      await ordersColRef.doc(orderId).set(orderDoc);
      console.log(`[OrderSync] New order saved — ${orderId} (case: ${caseId})`);
      newOrders.push(orderDoc);
    } catch (err) {
      console.error(`[OrderSync] Failed to save order ${orderId} for case ${caseId}:`, err);
    }
  }

  const skipped = ordersWithPdf.length - newOrders.length;
  console.log(
    `[OrderSync] Done for case ${caseId}: ` +
    `${newOrders.length} new order(s) written, ${skipped} already existed.`
  );

  return newOrders;
}

/**
 * Resolves the effective notification preference for a case.
 *  - If caseEnabled is a boolean, it wins (per-case override).
 *  - Otherwise, globalEnabled wins.
 *  - If neither is set, defaults to true (notifications on).
 */
function resolveNotificationEnabled(globalEnabled, caseEnabled) {
  if (typeof caseEnabled === "boolean") return caseEnabled;
  if (typeof globalEnabled === "boolean") return globalEnabled;
  return true;
}

/**
 * Schedules a push notification for the case owner when one or more new
 * NCLT orders are detected during the cron run.
 *
 * Rather than sending FCM directly, we write to `eventReminders` (same
 * collection used by hearing-date reminders) so the 8 AM delivery job
 * picks it up at a user-friendly time.
 *
 * Only fires for brand-new orders — orders already in the sub-collection
 * are never notified again.
 *
 * @param {string} ownerId   - Firestore user ID (owner of the case)
 * @param {string} caseId    - Firestore pending case document ID
 * @param {Array}  newOrders - Array of newly written order docs from syncNcltOrders()
 * @param {Object} ncltCase  - Full case document data from Firestore
 */
export async function notifyNewOrders(ownerId, caseId, newOrders, ncltCase) {
  if (!ownerId) {
    console.log(`[OrderNotify] No owner ID for case ${caseId}, skipping notification.`);
    return;
  }

  // Resolve notification preference (global then per-case)
  try {
    const ownerSnap = await db.collection("lawyers").doc(ownerId).get().then((snap) => {
      if (snap.exists) return snap;
      return db.collection("client").doc(ownerId).get();
    });

    const globalEnabled = ownerSnap.exists ? ownerSnap.data().notificationsEnabled : undefined;
    const caseEnabled   = ncltCase.notificationsEnabled;
    const shouldNotify  = resolveNotificationEnabled(globalEnabled, caseEnabled);

    if (!shouldNotify) {
      console.log(
        `[OrderNotify] Skipping order notification for case ${caseId} ` +
        `(global: ${globalEnabled}, case: ${caseEnabled})`
      );
      return;
    }
  } catch (err) {
    console.error(
      `[OrderNotify] Failed to resolve notification preferences for case ${caseId}:`, err
    );
    // Proceed to notify as fallback if the preference check itself fails
  }

  // Build a human-friendly message
  const count      = newOrders.length;
  const orderWord  = count === 1 ? "order" : "orders";
  const caseLabel  =
    ncltCase.petitionerName && ncltCase.respondentName
      ? `${ncltCase.petitionerName} VS ${ncltCase.respondentName}`
      : ncltCase.caseNo || caseId;

  const title = `New ${orderWord} in your case`;
  const body  =
    count === 1
      ? `A new order dated ${newOrders[0].order_date} has been added to ${caseLabel}.`
      : `${count} new ${orderWord} have been added to ${caseLabel}.`;

  // Schedule reminder for 8 AM today (same day as detection)
  const reminder8am = new Date();
  reminder8am.setHours(8, 0, 0, 0);

  try {
    const eventDoc = await db.collection("eventReminders").add({
      caseId,
      caseNo:           `${ncltCase.caseNo || ""}`,
      createdAt:        new Date(),
      eventTitle:       title,
      eventBody:        body,
      recipientId:      ownerId,
      scheduledBy:      ownerId,
      reminderTime:     reminder8am,
      status:           "scheduled",
      notificationType: "newOrder",
    });

    console.log(
      `[OrderNotify] eventReminders doc created for case ${caseId}: ${eventDoc.id}`
    );
  } catch (err) {
    console.error(`[OrderNotify] Failed to write eventReminders for case ${caseId}:`, err);
  }
}
