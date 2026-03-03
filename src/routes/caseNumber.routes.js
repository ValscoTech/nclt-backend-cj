import express from "express";
import { fetchByCaseNumber } from "../controllers/caseNumber.controller.js";

const router = express.Router();

router.post("/case-number", fetchByCaseNumber);

export default router;