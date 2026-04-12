import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// get current file directory (ESM replacement for __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// build correct absolute path
const serviceAccountPath = path.join(
  __dirname,
  "serviceAccountKey.json"
);

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = JSON.parse(
    fs.readFileSync(serviceAccountPath, "utf8")
  );
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

if (process.env.USE_EMULATOR === "true") {
  db.settings({
    host: "localhost:9090",
    ssl: false,
    projectId: "demo-project",
  });

  process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
  console.log("Using Firebase Emulators");
}

export { db, auth, admin };