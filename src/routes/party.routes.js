import express from "express";
import { fetchByPartyName } from "../controllers/party.controller.js";

const router = express.Router();

router.post("/party-name", fetchByPartyName);
router.post("/party", fetchByPartyName);

export default router;
