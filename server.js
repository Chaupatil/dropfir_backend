/**
 * DropFit Backend — Express + MongoDB
 * Connects to: mongodb+srv://patilchau:emtHw4o5YnsN9PyN@cluster0.3i57uqh.mongodb.net/
 * Database: dropfit
 * Collections:
 *   - dropfit  → daily water + exercise docs (one doc per user per day)
 *   - meals    → meal entries with optional base64 photo (separate collection
 *                to keep daily docs lean; photos can be 200-500KB each)
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

let db, col, mealCol;

async function connectDB() {
  const client = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
  });
  await client.connect();
  db = client.db(DB_NAME);

  // Daily water + exercise collection
  col = db.collection("dropfit");
  await col.createIndex({ userId: 1, date: 1 }, { unique: true });
  await col.createIndex({ userId: 1 });

  // Meals collection — separate so large base64 photos don't bloat daily docs
  mealCol = db.collection("meals");
  await mealCol.createIndex({ userId: 1, date: 1 });
  await mealCol.createIndex({ userId: 1 });
  await mealCol.createIndex({ clientId: 1 }); // for fast delete by frontend id

  console.log("✅ MongoDB connected — dropfit.dropfit + dropfit.meals");
}

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());

// Increase body size limit to 5MB to accommodate base64 photos
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "5mb", extended: true }));
app.use(express.static(path.join(__dirname)));

const getToday = () => new Date().toISOString().slice(0, 10);
const DEFAULT_USER = "user_default";

// ─── Helper: get or create today's daily doc ─────────────────
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

// ─── Fix bad indexes (run once on startup) ───────────────────
async function fixIndexes() {
  try {
    const indexes = await col.indexes();
    for (const idx of indexes) {
      // Drop any legacy indexes that are not the ones we want
      if (
        idx.name !== "_id_" &&
        idx.name !== "userId_1_date_1" &&
        idx.name !== "userId_1"
      ) {
        console.log(`⚠️  Dropping legacy index: ${idx.name}`);
        await col.dropIndex(idx.name).catch(() => {});
      }
    }
  } catch (err) {
    console.warn("Index cleanup warning:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// WATER ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/today
app.get("/api/today", async (req, res) => {
  try {
    const doc = await getTodayDoc();
    // Attach today's meals from the meals collection
    const date = getToday();
    const meals = await mealCol
      .find({ userId: DEFAULT_USER, date })
      .sort({ createdAt: 1 })
      .toArray();
    // Strip the heavy _id from each meal to keep response clean
    const cleanMeals = meals.map(({ _id, ...rest }) => rest);
    res.json({ success: true, data: { ...doc, meals: cleanMeals } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/water
app.post("/api/water", async (req, res) => {
  try {
    const { ml, id, time } = req.body;
    if (!ml || ml <= 0)
      return res.status(400).json({ error: "Invalid ml value" });

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

// DELETE /api/water/:id
app.delete("/api/water/:id", async (req, res) => {
  try {
    const date = getToday();
    const result = await col.updateOne(
      { userId: DEFAULT_USER, date },
      {
        $pull: { water: { id: req.params.id } },
        $set: { updatedAt: new Date() },
      },
    );
    res.json({ success: true, modified: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// EXERCISE ROUTES
// ═══════════════════════════════════════════════════════════════

// POST /api/exercise
app.post("/api/exercise", async (req, res) => {
  try {
    const { type, duration, calories, id, time } = req.body;
    if (!type || !duration)
      return res.status(400).json({ error: "Missing fields" });

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
        $pull: { exercises: { id: req.params.id } },
        $set: { updatedAt: new Date() },
      },
    );
    res.json({ success: true, modified: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// MEAL ROUTES  (separate collection — supports large base64 photos)
// ═══════════════════════════════════════════════════════════════

// POST /api/meal — add a meal entry
app.post("/api/meal", async (req, res) => {
  try {
    const { id, name, category, photo, time } = req.body;

    if (!name || !category)
      return res.status(400).json({ error: "name and category are required" });

    const validCategories = ["breakfast", "lunch", "snacks", "dinner"];
    if (!validCategories.includes(category))
      return res.status(400).json({ error: "Invalid category" });

    const date = getToday();
    const meal = {
      // clientId is the Date.now() id sent by the frontend — used for fast deletes
      clientId: id ? String(id) : new ObjectId().toString(),
      userId: DEFAULT_USER,
      date,
      name: String(name).trim().slice(0, 200), // cap name length
      category,
      // photo is a base64 data URL string, e.g. "data:image/jpeg;base64,..."
      // We store it directly. Max body is 5MB so photos should be fine after frontend resize.
      photo: photo || null,
      time:
        time ||
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      createdAt: new Date(),
    };

    await mealCol.insertOne(meal);

    // Return without MongoDB's _id
    const { _id, ...cleanMeal } = meal;
    res.json({ success: true, meal: cleanMeal });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/meal/:id — delete by clientId (the frontend's Date.now() id)
app.delete("/api/meal/:id", async (req, res) => {
  try {
    const result = await mealCol.deleteOne({
      userId: DEFAULT_USER,
      clientId: req.params.id,
    });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/meals?date=YYYY-MM-DD — get meals for a specific date (optional, defaults to today)
app.get("/api/meals", async (req, res) => {
  try {
    const date = req.query.date || getToday();
    const meals = await mealCol
      .find({ userId: DEFAULT_USER, date })
      .sort({ createdAt: 1 })
      .toArray();
    const cleanMeals = meals.map(({ _id, ...rest }) => rest);
    res.json({ success: true, data: cleanMeals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SETTINGS + HISTORY + STATS
// ═══════════════════════════════════════════════════════════════

// PATCH /api/settings
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

// GET /api/history?days=30
app.get("/api/history", async (req, res) => {
  try {
    const days = Number(req.query.days) || 30;
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().slice(0, 10);

    // Fetch daily docs
    const docs = await col
      .find({ userId: DEFAULT_USER, date: { $gte: fromStr } })
      .sort({ date: -1 })
      .toArray();

    // Fetch meals for the same period grouped by date
    const mealDocs = await mealCol
      .find({ userId: DEFAULT_USER, date: { $gte: fromStr } })
      .sort({ createdAt: 1 })
      .toArray();

    // Group meals by date
    const mealsByDate = {};
    for (const m of mealDocs) {
      if (!mealsByDate[m.date]) mealsByDate[m.date] = [];
      const { _id, ...clean } = m;
      mealsByDate[m.date].push(clean);
    }

    // Attach meals to each daily doc
    const enriched = docs.map((d) => ({
      ...d,
      meals: mealsByDate[d.date] || [],
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/stats
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

// GET /api/health — real ping
app.get("/api/health", async (req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ status: "ok", db: true, timestamp: new Date() });
  } catch (err) {
    res.json({ status: "ok", db: false, timestamp: new Date() });
  }
});

// GET /api/fix-indexes — one-time fix for legacy deviceId_1 index
// Hit this endpoint ONCE if you see E11000 duplicate key errors, then you can remove this route.
app.get("/api/fix-indexes", async (req, res) => {
  try {
    const indexes = await col.indexes();
    const dropped = [];
    for (const idx of indexes) {
      if (
        idx.name !== "_id_" &&
        idx.name !== "userId_1_date_1" &&
        idx.name !== "userId_1"
      ) {
        await col.dropIndex(idx.name);
        dropped.push(idx.name);
      }
    }
    await col.createIndex({ userId: 1, date: 1 }, { unique: true });
    await col.createIndex({ userId: 1 });
    res.json({ success: true, dropped, message: "Indexes fixed ✅" });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────
connectDB()
  .then(async () => {
    await fixIndexes();
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
