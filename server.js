const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const CONTEXT_SERVICE_URL = process.env.CONTEXT_SERVICE_URL || "https://operative-production-ed21.up.railway.app";
const AOS_AGENT_URL = process.env.AOS_AGENT_URL || "https://aos-nurture-agent-production.up.railway.app";
const STAQ_AGENT_URL = process.env.STAQ_AGENT_URL || "https://staq-prospecting-agent-production.up.railway.app";
const COMPETITIVE_AGENT_URL = process.env.COMPETITIVE_AGENT_URL || "https://operative-competitive-intel-agent-production.up.railway.app";
const EDITOR_PASSWORD = process.env.EDITOR_PASSWORD || "operative2026";

// ── Auth middleware for editor routes ──
function requireAuth(req, res, next) {
  const token = req.headers["x-editor-token"];
  if (token === EDITOR_PASSWORD) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// Proxy agent status checks
app.get("/api/status", async (req, res) => {
  const agents = [
    { id: "context", name: "Context Service", url: CONTEXT_SERVICE_URL },
    { id: "aos", name: "AOS Nurture Agent", url: AOS_AGENT_URL },
    { id: "staq", name: "STAQ Prospecting Agent", url: STAQ_AGENT_URL },
    { id: "competitive", name: "Competitive Intel Agent", url: COMPETITIVE_AGENT_URL },
  ];

  const results = await Promise.all(
    agents.map(async (agent) => {
      try {
        const r = await fetch(`${agent.url}/`, { timeout: 5000 });
        const data = await r.json();
        return { ...agent, status: "online", detail: data };
      } catch (err) {
        return { ...agent, status: "offline", detail: null };
      }
    })
  );

  res.json(results);
});

// Proxy learnings from context service
app.get("/api/learnings", async (req, res) => {
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/learnings-list`);
    if (!r.ok) throw new Error("Failed to fetch learnings");
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger competitive intel run
app.post("/api/run-competitive", async (req, res) => {
  const { competitor } = req.body;
  try {
    const r = await fetch(`${COMPETITIVE_AGENT_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(competitor ? { competitor } : {}),
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a learning entry
app.post("/api/learnings", async (req, res) => {
  const { agent, note } = req.body;
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/learnings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, note }),
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Context editor endpoints (protected) ──

// List all context files
app.get("/api/context/files", requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/files`);
    if (!r.ok) throw new Error("Failed to fetch file list");
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single file's content
app.get("/api/context/file", requireAuth, async (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: "path required" });
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/file?path=${encodeURIComponent(filePath)}`);
    if (!r.ok) throw new Error("Failed to fetch file");
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save a file's content
app.post("/api/context/file", requireAuth, async (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) return res.status(400).json({ error: "path and content required" });
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, content }),
    });
    if (!r.ok) throw new Error("Failed to save file");
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify editor password
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (password === EDITOR_PASSWORD) {
    res.json({ ok: true, token: EDITOR_PASSWORD });
  } else {
    res.status(401).json({ ok: false, error: "Invalid password" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Operative Marketing OS dashboard running on port ${PORT}`);
});
