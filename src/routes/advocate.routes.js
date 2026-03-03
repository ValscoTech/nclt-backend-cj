import express from "express";
import { fetchByAdvocate } from "../controllers/advocate.controller.js";

const router = express.Router();

router.post("/advocate-name", fetchByAdvocate);

export default router;