import express from "express";
import { fetchFilingPopup } from "../controllers/filing.controller.js";

const router = express.Router();

// Popup/accordion details endpoint (on click)
router.get("/filing/:filingNo", fetchFilingPopup);

export default router;
