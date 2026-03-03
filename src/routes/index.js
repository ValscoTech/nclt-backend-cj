import express from "express";
import cinRoutes from "./cin.routes.js";
import filingRoutes from "./filing.routes.js";
import partyRoutes from "./party.routes.js"
import caseNumberRoutes from "./caseNumber.routes.js";
import advocateRoutes from "./advocate.routes.js";
const router = express.Router();

router.use("/", advocateRoutes);
router.use("/", cinRoutes);
router.use("/", filingRoutes);
router.use("/", partyRoutes);
router.use("/", caseNumberRoutes);
export default router;
