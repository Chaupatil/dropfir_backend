/**
 * DropFit Backend — Express + MongoDB
 * Connects to: mongodb+srv://patilchau:emtHw4o5YnsN9PyN@cluster0.3i57uqh.mongodb.net/
 * Database: dropfit | Collection: dropfit
 */

const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MongoDB Config ───────────────────────────────────────────
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://patilchau:emtHw4o5YnsN9PyN@cluster0.3i57uqh.mongodb.net/";
const DB_NAME = "dropfit";
const COLLECTION = "dropfit";

let db, col;

async function connectDB() {
  const client = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
  });
  await client.connect();
  db = client.db(DB_NAME);
  col = db.collection(COLLECTION);
  console.log("✅ MongoDB connected — dropfit.dropfit");

  // Indexes
  await col.createIndex({ userId: 1, date: 1 }, { unique: true });
  await col.createIndex({ userId: 1 });
}

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const getToday = () => new Date().toISOString().slice(0, 10);

// Default userId (single-user app; extend with auth if needed)
const DEFAULT_USER = "user_default";

// ─── Helper: get or create today's doc ───────────────────────
async function getTodayDoc(userId = DEFAULT_USER) {
  const date = getToday();
  let doc = await col.findOne({ userId, date });
  if (!doc) {
    doc = {
      userId,
      date,
      waterGoal: 2000,
      water: [],
      exercises: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await col.insertOne(doc);
  }
  return doc;
}

// ─── ROUTES ───────────────────────────────────────────────────

// GET /api/today — get today's data
app.get("/api/today", async (req, res) => {
  try {
    const doc = await getTodayDoc();
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/water — add water entry
app.post("/api/water", async (req, res) => {
  try {
    const { ml, id, time } = req.body;
    if (!ml || ml <= 0)
      return res.status(400).json({ error: "Invalid ml value" });

    // ✅ Use the id sent by the frontend so DELETE will match
    const entry = {
      id: id ? String(id) : new ObjectId().toString(),
      ml: Number(ml),
      time:
        time ||
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      createdAt: new Date(),
    };

    const date = getToday();
    await col.updateOne(
      { userId: DEFAULT_USER, date },
      {
        $push: { water: entry },
        $set: { updatedAt: new Date() },
        $setOnInsert: {
          userId: DEFAULT_USER,
          date,
          waterGoal: 2000,
          exercises: [],
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/water/:id — remove water entry
app.delete("/api/water/:id", async (req, res) => {
  try {
    const date = getToday();
    const result = await col.updateOne(
      { userId: DEFAULT_USER, date },
      {
        // ✅ Match by string id (same as what the frontend sent on POST)
        $pull: { water: { id: req.params.id } },
        $set: { updatedAt: new Date() },
      },
    );
    res.json({ success: true, modified: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/exercise — add exercise
app.post("/api/exercise", async (req, res) => {
  try {
    const { type, duration, calories, id, time } = req.body;
    if (!type || !duration)
      return res.status(400).json({ error: "Missing fields" });

    // ✅ Use the id sent by the frontend so DELETE will match
    const entry = {
      id: id ? String(id) : new ObjectId().toString(),
      type,
      duration: Number(duration),
      calories: Number(calories) || 0,
      time:
        time ||
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      createdAt: new Date(),
    };

    const date = getToday();
    await col.updateOne(
      { userId: DEFAULT_USER, date },
      {
        $push: { exercises: entry },
        $set: { updatedAt: new Date() },
        $setOnInsert: {
          userId: DEFAULT_USER,
          date,
          waterGoal: 2000,
          water: [],
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/exercise/:id
app.delete("/api/exercise/:id", async (req, res) => {
  try {
    const date = getToday();
    const result = await col.updateOne(
      { userId: DEFAULT_USER, date },
      {
        // ✅ Match by string id (same as what the frontend sent on POST)
        $pull: { exercises: { id: req.params.id } },
        $set: { updatedAt: new Date() },
      },
    );
    res.json({ success: true, modified: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/settings — update water goal
app.patch("/api/settings", async (req, res) => {
  try {
    const { waterGoal } = req.body;
    const date = getToday();
    await col.updateOne(
      { userId: DEFAULT_USER, date },
      {
        $set: { waterGoal: Number(waterGoal), updatedAt: new Date() },
        $setOnInsert: {
          userId: DEFAULT_USER,
          date,
          water: [],
          exercises: [],
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/history?days=30 — get history
app.get("/api/history", async (req, res) => {
  try {
    const days = Number(req.query.days) || 30;
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().slice(0, 10);

    const docs = await col
      .find({ userId: DEFAULT_USER, date: { $gte: fromStr } })
      .sort({ date: -1 })
      .toArray();

    res.json({ success: true, data: docs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/stats — aggregated stats
app.get("/api/stats", async (req, res) => {
  try {
    const docs = await col
      .find({ userId: DEFAULT_USER })
      .sort({ date: -1 })
      .limit(30)
      .toArray();

    const stats = docs.map((d) => ({
      date: d.date,
      totalWater: d.water.reduce((s, e) => s + e.ml, 0),
      totalExerciseMin: d.exercises.reduce((s, e) => s + e.duration, 0),
      totalCalories: d.exercises.reduce((s, e) => s + e.calories, 0),
      workoutCount: d.exercises.length,
      goalMet: d.water.reduce((s, e) => s + e.ml, 0) >= (d.waterGoal || 2000),
    }));

    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Fixed health check — does a real ping instead of just checking if db object exists
app.get("/api/health", async (req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ status: "ok", db: true, timestamp: new Date() });
  } catch (err) {
    res.json({ status: "ok", db: false, timestamp: new Date() });
  }
});

// ─── Start ────────────────────────────────────────────────────
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 DropFit server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err.message);
    console.log("⚡ Starting without DB (localStorage fallback mode)...");
    app.listen(PORT, () => {
      console.log(`🚀 DropFit server running at http://localhost:${PORT}`);
    });
  });
