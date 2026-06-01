const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
    { id: "aos", name: "AOS Prospecting Agent", url: AOS_AGENT_URL },
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


// ── File upload + Claude cleanup ──
app.post("/api/context/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });

  const { originalname, buffer, mimetype } = req.file;
  let rawText = "";

  // Extract text based on file type
  try {
    if (mimetype === "text/plain" || originalname.endsWith(".md") || originalname.endsWith(".txt")) {
      rawText = buffer.toString("utf8");
    } else if (originalname.endsWith(".html") || mimetype === "text/html") {
      rawText = buffer.toString("utf8").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ").trim();
    } else {
      // For docx/pdf — send raw base64 to Claude with document type
      rawText = null;
    }
  } catch (err) {
    return res.status(500).json({ error: "Could not extract text: " + err.message });
  }

  // Send to Claude for cleanup and formatting
  try {
    let messages;

    if (rawText !== null) {
      messages = [{
        role: "user",
        content: `You are formatting a document for Operative's marketing context layer. 
        
The context layer contains markdown files used by AI agents for positioning, ICP data, brand voice, and campaign learnings.

Here is the raw content from a file called "${originalname}":

---
${rawText.slice(0, 8000)}
---

Clean this up and reformat it as a well-structured markdown context file that:
- Has a clear H1 title
- Uses H2 and H3 headings to organize sections
- Removes any formatting artifacts, page numbers, headers/footers
- Preserves all substantive content and data
- Uses bullet points and tables where appropriate
- Is ready to be used as a reference document by an AI agent

Return ONLY the cleaned markdown content, no preamble.`
      }];
    } else {
      // Send as base64 document (PDF or DOCX)
      const base64 = buffer.toString("base64");
      const mediaType = originalname.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      
      messages = [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: mediaType, data: base64 }
          },
          {
            type: "text",
            text: `You are formatting a document for Operative's marketing context layer.

The context layer contains markdown files used by AI agents for positioning, ICP data, brand voice, and campaign learnings.

Clean up and reformat the content of this document called "${originalname}" as a well-structured markdown context file that:
- Has a clear H1 title
- Uses H2 and H3 headings to organize sections
- Removes any formatting artifacts, page numbers, headers/footers
- Preserves all substantive content and data
- Uses bullet points and tables where appropriate
- Is ready to be used as a reference document by an AI agent

Return ONLY the cleaned markdown content, no preamble.`
          }
        ]
      }];
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages
      })
    });

    const data = await r.json();
    const cleaned = data.content?.[0]?.text || "";

    if (!cleaned) return res.status(500).json({ error: "Claude returned no content" });

    // Suggest filename from original
    const suggestedName = originalname
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") + ".md";

    res.json({ content: cleaned, suggestedName });

  } catch (err) {
    res.status(500).json({ error: "Claude processing failed: " + err.message });
  }
});


// Context health check
app.get("/api/context-health", async (req, res) => {
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/context-health`);
    if (!r.ok) throw new Error("Failed");
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
