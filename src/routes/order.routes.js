import express from "express";
import { downloadOrder } from "../controllers/order.controller.js";

const router = express.Router();
console.log("ORDER ROUTE LOADED");

router.get("/order", downloadOrder);

export default router;