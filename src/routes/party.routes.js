import express from "express";
import {
  fetchByPartyName,
  fetchPartyDetails,
} from "../controllers/party.controller.js";

const router = express.Router();

router.post("/party-name", fetchByPartyName);
router.post("/party", fetchByPartyName);
router.get("/party/:filingNo", fetchPartyDetails);

export default router;
