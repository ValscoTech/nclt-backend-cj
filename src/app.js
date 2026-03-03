import express from "express";
import cors from "cors";
import routes from "./routes/index.js";

const app = express();

app.use(express.json());
app.use(cors());

// mount routes
app.use("/", routes);

// health check
app.get("/ping", (req, res) => res.json({ ok: true }));

export default app;