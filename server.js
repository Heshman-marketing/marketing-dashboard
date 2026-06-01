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
    // Read learnings files via context service
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

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Operative Marketing OS dashboard running on port ${PORT}`);
});
