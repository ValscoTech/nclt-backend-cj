import express from "express";
import { fetchByCIN } from "../controllers/cin.controller.js";

const router = express.Router();

// CIN list endpoint (table data)
router.post("/cin", fetchByCIN);

export default router;
