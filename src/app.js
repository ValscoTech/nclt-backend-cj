import express from "express";
import cors from "cors";
import routes from "./routes/index.js";

const app = express();

const allowedOrigins = [
  "https://jr-portal.vercel.app",
  "http://localhost:3000",
  "https://www.jurident.com",
];

app.use(express.json());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);


// mount routes
app.use("/", routes);

// health check
app.get("/ping", (req, res) => res.json({ ok: true }));

export default app;
