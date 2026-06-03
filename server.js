const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY      = process.env.ANTHROPIC_API_KEY;
const HUBSPOT_API_KEY        = process.env.HUBSPOT_API_KEY;
const GA_PROPERTY_ID         = process.env.GA_PROPERTY_ID;          // e.g. "properties/123456789"
const GA_SERVICE_ACCOUNT_KEY = process.env.GA_SERVICE_ACCOUNT_KEY;  // full JSON string of service account key
const CONTEXT_SERVICE_URL    = process.env.CONTEXT_SERVICE_URL    || "https://operative-production-ed21.up.railway.app";
const AOS_AGENT_URL          = process.env.AOS_AGENT_URL           || "https://aos-nurture-agent-production.up.railway.app";
const STAQ_AGENT_URL         = process.env.STAQ_AGENT_URL          || "https://staq-prospecting-agent-production.up.railway.app";
const COMPETITIVE_AGENT_URL  = process.env.COMPETITIVE_AGENT_URL   || "https://operative-competitive-intel-agent-production.up.railway.app";
const EDITOR_PASSWORD        = process.env.EDITOR_PASSWORD         || "operative2026";

// ── Auth ──────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers["x-editor-token"];
  if (token === EDITOR_PASSWORD) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ── Agent status ──────────────────────────────────────────────────────────────
app.get("/api/status", async (req, res) => {
  const agents = [
    { id: "context",     name: "Context Service",         url: CONTEXT_SERVICE_URL },
    { id: "aos",         name: "AOS Prospecting Agent",   url: AOS_AGENT_URL },
    { id: "staq",        name: "STAQ Prospecting Agent",  url: STAQ_AGENT_URL },
    { id: "competitive", name: "Competitive Intel Agent", url: COMPETITIVE_AGENT_URL },
  ];
  const results = await Promise.all(agents.map(async (agent) => {
    try {
      const r = await fetch(`${agent.url}/`, { timeout: 5000 });
      const data = await r.json();
      return { ...agent, status: "online", detail: data };
    } catch { return { ...agent, status: "offline", detail: null }; }
  }));
  res.json(results);
});

// ── Learnings ─────────────────────────────────────────────────────────────────
app.get("/api/learnings", async (req, res) => {
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/learnings-list`);
    if (!r.ok) throw new Error("Failed");
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/learnings", async (req, res) => {
  const { agent, note } = req.body;
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/learnings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, note }),
    });
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Competitive ───────────────────────────────────────────────────────────────
app.post("/api/run-competitive", async (req, res) => {
  const { competitor } = req.body;
  try {
    const r = await fetch(`${COMPETITIVE_AGENT_URL}/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(competitor ? { competitor } : {}),
    });
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Context editor (protected) ────────────────────────────────────────────────
app.get("/api/context/files", requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/files`);
    if (!r.ok) throw new Error("Failed");
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/context/file", requireAuth, async (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: "path required" });
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/file?path=${encodeURIComponent(filePath)}`);
    if (!r.ok) throw new Error("Failed");
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/context/file", requireAuth, async (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) return res.status(400).json({ error: "path and content required" });
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/file`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, content }),
    });
    if (!r.ok) throw new Error("Failed");
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Context: fetch URL for Link Article feature ───────────────────────────────
app.post("/api/context/fetch-url", requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OperativeBrain/1.0)" },
      timeout: 10000,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    // Strip tags
    const title = (html.match(/<title[^>]*>(.*?)<\/title>/i) || [])[1] || "";
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    res.json({ content: text.slice(0, 50000), title: title.replace(/<[^>]+>/g, "").trim() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (password === EDITOR_PASSWORD) res.json({ ok: true, token: EDITOR_PASSWORD });
  else res.status(401).json({ ok: false, error: "Invalid password" });
});

// ── File upload + Claude cleanup ──────────────────────────────────────────────
app.post("/api/context/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });
  const { originalname, buffer, mimetype } = req.file;
  let rawText = "";
  try {
    if (mimetype === "text/plain" || originalname.endsWith(".md") || originalname.endsWith(".txt")) {
      rawText = buffer.toString("utf8");
    } else if (originalname.endsWith(".html") || mimetype === "text/html") {
      rawText = buffer.toString("utf8")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    } else { rawText = null; }
  } catch (err) { return res.status(500).json({ error: "Could not extract text: " + err.message }); }

  try {
    let messages;
    const prompt = `You are formatting a document for Operative's marketing context layer. Clean up and reformat as well-structured markdown with a clear H1 title, H2/H3 sections, no artifacts. Return ONLY the cleaned markdown, no preamble. File: "${originalname}"`;
    if (rawText !== null) {
      messages = [{ role: "user", content: `${prompt}\n\n---\n${rawText.slice(0, 8000)}\n---` }];
    } else {
      const base64 = buffer.toString("base64");
      const mediaType = originalname.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      messages = [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: mediaType, data: base64 } }, { type: "text", text: prompt }] }];
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4000, messages }),
    });
    const data = await r.json();
    const cleaned = data.content?.[0]?.text || "";
    if (!cleaned) return res.status(500).json({ error: "Claude returned no content" });
    const suggestedName = originalname.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".md";
    res.json({ content: cleaned, suggestedName });
  } catch (err) { res.status(500).json({ error: "Claude processing failed: " + err.message }); }
});

// ── Context health ─────────────────────────────────────────────────────────────
app.get("/api/context-health", async (req, res) => {
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/context-health`);
    if (!r.ok) throw new Error("Failed");
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── HubSpot email contacts ─────────────────────────────────────────────────────
app.get("/api/email-outputs", async (req, res) => {
  const { agent } = req.query;
  if (!agent) return res.status(400).json({ error: "agent required" });
  const isAOS = agent === "aos";
  const properties = isAOS
    ? ["firstname", "lastname", "email", "company", "jobtitle", "nurture_email_1", "nurture_email_2", "nurture_email_3"]
    : ["firstname", "lastname", "email", "company", "jobtitle", "staq_email_1_body", "staq_email_2_body", "staq_email_3_body"];
  const filterProperty = isAOS ? "nurture_email_1" : "staq_email_1_body";
  try {
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${HUBSPOT_API_KEY}` },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: filterProperty, operator: "HAS_PROPERTY" }] }],
        properties,
        sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
        limit: 20,
      }),
    });
    const data = await r.json();
    const contacts = (data.results || []).map(c => ({
      id: c.id,
      firstname: c.properties.firstname || "",
      lastname: c.properties.lastname || "",
      email: c.properties.email || "",
      company: c.properties.company || "",
      jobtitle: c.properties.jobtitle || "",
      emails: isAOS
        ? [c.properties.nurture_email_1 || "", c.properties.nurture_email_2 || "", c.properties.nurture_email_3 || ""]
        : [c.properties.staq_email_1_body || "", c.properties.staq_email_2_body || "", c.properties.staq_email_3_body || ""],
    }));
    res.json(contacts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── HubSpot email metrics ──────────────────────────────────────────────────────
app.get("/api/email-metrics", async (req, res) => {
  const emails = [
    { name: "AOS Nurture Email 1", id: "209930076194", group: "AOS" },
    { name: "AOS Nurture Email 2", id: "209930191703", group: "AOS" },
    { name: "AOS Nurture Email 3", id: "209930208573", group: "AOS" },
    { name: "STAQ Nurture Email 1", id: "210411155104", group: "STAQ" },
    { name: "STAQ Nurture Email 2", id: "210407639089", group: "STAQ" },
    { name: "STAQ Nurture Email 3", id: "210407658574", group: "STAQ" },
  ];
  try {
    const metrics = await Promise.all(emails.map(async (email) => {
      const emailRes = await fetch(`https://api.hubapi.com/marketing/v3/emails/${email.id}`, {
        headers: { "Authorization": `Bearer ${HUBSPOT_API_KEY}` },
      });
      if (!emailRes.ok) return { ...email, found: false };
      const emailData = await emailRes.json();
      const campaignIds = emailData.allEmailCampaignIds || [];
      if (!campaignIds.length) return { ...email, found: false };
      let totalSent = 0, totalDelivered = 0, totalOpened = 0, totalClicked = 0, found = false;
      for (const cid of campaignIds) {
        const sr = await fetch(`https://api.hubapi.com/email/public/v1/campaigns/${cid}`, {
          headers: { "Authorization": `Bearer ${HUBSPOT_API_KEY}` },
        });
        if (sr.ok) {
          const d = await sr.json();
          const c = d.counters || {};
          totalSent += c.sent || 0;
          totalDelivered += c.delivered || 0;
          totalOpened += c.open || c.opens || 0;
          totalClicked += c.click || c.clicks || 0;
          found = true;
        }
      }
      if (!found) return { ...email, found: false };
      const denom = totalDelivered || totalSent;
      return {
        name: email.name, group: email.group, found: true,
        sent: totalSent, opened: totalOpened, clicked: totalClicked,
        openRate: denom > 0 ? ((totalOpened / denom) * 100).toFixed(1) : "0.0",
        clickRate: denom > 0 ? ((totalClicked / denom) * 100).toFixed(1) : "0.0",
      };
    }));
    res.json(metrics);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Google Analytics helper ────────────────────────────────────────────────────
// Uses GA4 Data API with a service account key stored as JSON string in env var.
// Returns null if GA is not configured.
async function fetchGAMetrics() {
  if (!GA_PROPERTY_ID || !GA_SERVICE_ACCOUNT_KEY) return null;
  try {
    // Parse service account key
    const sa = JSON.parse(GA_SERVICE_ACCOUNT_KEY);

    // Get OAuth2 access token via JWT
    const jwt = await makeServiceAccountJWT(sa);
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return null;
    const token = tokenData.access_token;

    // Run two GA4 reports in parallel: sessions/conversions overview + top pages
    const [overviewRes, pagesRes] = await Promise.all([
      fetch(`https://analyticsdata.googleapis.com/v1beta/${GA_PROPERTY_ID}:runReport`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
            { name: "screenPageViews" },
            { name: "conversions" },
            { name: "bounceRate" },
            { name: "averageSessionDuration" },
          ],
        }),
      }),
      fetch(`https://analyticsdata.googleapis.com/v1beta/${GA_PROPERTY_ID}:runReport`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }, { name: "sessions" }],
          orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
          limit: 10,
        }),
      }),
    ]);

    const overviewData = await overviewRes.json();
    const pagesData = await pagesRes.json();

    const row = overviewData.rows?.[0]?.metricValues || [];
    const overview = {
      sessions: row[0]?.value || "0",
      users: row[1]?.value || "0",
      pageviews: row[2]?.value || "0",
      conversions: row[3]?.value || "0",
      bounceRate: row[4]?.value ? (parseFloat(row[4].value) * 100).toFixed(1) + "%" : "n/a",
      avgSessionDuration: row[5]?.value ? Math.round(parseFloat(row[5].value)) + "s" : "n/a",
    };

    const topPages = (pagesData.rows || []).slice(0, 10).map(r => ({
      page: r.dimensionValues[0]?.value,
      views: r.metricValues[0]?.value,
      sessions: r.metricValues[1]?.value,
    }));

    return { overview, topPages, period: "last 30 days" };
  } catch (err) {
    console.error("[GA] error:", err.message);
    return null;
  }
}

// Minimal JWT implementation for service account auth
async function makeServiceAccountJWT(sa) {
  const crypto = require("crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })).toString("base64url");
  const sigInput = `${header}.${payload}`;
  const privateKey = sa.private_key;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(sigInput);
  const sig = sign.sign(privateKey, "base64url");
  return `${sigInput}.${sig}`;
}

// ── Context assembly for Marketing Brain ──────────────────────────────────────
async function assembleBrainContext() {
  const parts = [];

  // 1. Context layer files
  try {
    const [globalRes, aosRes, staqRes, competitiveRes] = await Promise.all([
      fetch(`${CONTEXT_SERVICE_URL}/file?path=global/operative-products.md`),
      fetch(`${CONTEXT_SERVICE_URL}/file?path=agents/aos-nurture.md`),
      fetch(`${CONTEXT_SERVICE_URL}/file?path=agents/staq-prospecting.md`),
      fetch(`${CONTEXT_SERVICE_URL}/file?path=global/competitive-overview.md`),
    ]);
    const files = [globalRes, aosRes, staqRes, competitiveRes];
    for (const r of files) {
      if (r.ok) { const d = await r.json(); if (d.content) parts.push(d.content); }
    }
  } catch (err) { console.error("[brain context] context files:", err.message); }

  // 2. Recent learnings
  try {
    const r = await fetch(`${CONTEXT_SERVICE_URL}/learnings-list`);
    if (r.ok) {
      const entries = await r.json();
      const recent = entries.slice(0, 10)
        .map(e => `${e.date} — ${e.agent}: ${e.note.slice(0, 300)}`).join("\n");
      if (recent) parts.push(`## Recent Agent Learnings\n${recent}`);
    }
  } catch (err) { console.error("[brain context] learnings:", err.message); }

  // 3. HubSpot email metrics — all outbound emails with any send activity
  try {
    // Fetch all marketing emails, no state filter — get everything that has been sent
    const allEmails = [];
    let after = null;
    do {
      const qs = `limit=50&orderBy=-updatedAt${after ? `&after=${after}` : ""}`;
      const r = await fetch(`https://api.hubapi.com/marketing/v3/emails?${qs}`, {
        headers: { "Authorization": `Bearer ${HUBSPOT_API_KEY}` },
      });
      if (!r.ok) break;
      const data = await r.json();
      allEmails.push(...(data.results || []));
      after = data.paging?.next?.after || null;
    } while (after && allEmails.length < 200);

    // For each email, get stats directly from the email object's counters
    // (avoids campaign endpoint entirely — works even without HubSpot campaigns)
    const metricsRows = await Promise.all(allEmails.map(async (email) => {
      // Try getting detailed stats via the email stats endpoint first
      let sent = 0, delivered = 0, opened = 0, clicked = 0;

      try {
        const sr = await fetch(`https://api.hubapi.com/marketing/v3/emails/${email.id}/statistics/histogram?interval=total`, {
          headers: { "Authorization": `Bearer ${HUBSPOT_API_KEY}` },
        });
        if (sr.ok) {
          const sd = await sr.json();
          const c = sd.counters || sd.totals || sd.results?.[0]?.counters || {};
          sent = c.sent || c.SENT || 0;
          delivered = c.delivered || c.DELIVERED || 0;
          opened = c.open || c.opens || c.OPEN || c.OPENED || 0;
          clicked = c.click || c.clicks || c.CLICK || c.CLICKED || 0;
        }
      } catch {}

      // Fallback: use counters on the email object itself
      if (!sent) {
        const c = email.counters || email.statistics || {};
        sent = c.sent || c.SENT || 0;
        delivered = c.delivered || c.DELIVERED || 0;
        opened = c.open || c.opens || c.OPEN || c.OPENED || 0;
        clicked = c.click || c.clicks || c.CLICK || c.CLICKED || 0;
      }

      // Fallback: try campaign IDs if available
      if (!sent && email.allEmailCampaignIds?.length) {
        for (const cid of email.allEmailCampaignIds) {
          const cr = await fetch(`https://api.hubapi.com/email/public/v1/campaigns/${cid}`, {
            headers: { "Authorization": `Bearer ${HUBSPOT_API_KEY}` },
          });
          if (cr.ok) {
            const cd = await cr.json(); const c = cd.counters || {};
            sent += c.sent || 0; delivered += c.delivered || 0;
            opened += c.open || c.opens || 0; clicked += c.click || c.clicks || 0;
          }
        }
      }

      if (!sent) return null;
      const denom = delivered || sent;
      const name = email.name || email.subject || `Email ${email.id}`;
      return `${name}: ${sent} sent, ${denom > 0 ? ((opened/denom)*100).toFixed(1) : 0}% open rate, ${denom > 0 ? ((clicked/denom)*100).toFixed(1) : 0}% CTR`;
    }));

    const rows = metricsRows.filter(Boolean);
    if (rows.length) {
      parts.push(`## HubSpot Email Performance (${rows.length} emails)\n${rows.join("\n")}`);
    }
  } catch (err) { console.error("[brain context] hubspot:", err.message); }

  // 4. Google Analytics
  try {
    const ga = await fetchGAMetrics();
    if (ga) {
      const { overview, topPages } = ga;
      const topPagesStr = topPages.map(p => `  ${p.page} — ${p.views} views`).join("\n");
      parts.push(
        `## Website Analytics (Last 30 Days)\n` +
        `Sessions: ${overview.sessions} | Users: ${overview.users} | Pageviews: ${overview.pageviews}\n` +
        `Conversions: ${overview.conversions} | Bounce rate: ${overview.bounceRate} | Avg session: ${overview.avgSessionDuration}\n` +
        `\nTop Pages:\n${topPagesStr}`
      );
    }
  } catch (err) { console.error("[brain context] ga:", err.message); }

  return parts.join("\n\n---\n\n");
}

// Legacy endpoint (still used by old frontend calls)
app.get("/api/context-for-brain", async (req, res) => {
  try {
    const context = await assembleBrainContext();
    res.json({ context });
  } catch (err) { res.json({ context: "" }); }
});

// ── Marketing Brain endpoint ───────────────────────────────────────────────────
// POST /api/brain
// Body: { messages: [{role, content}], conversationHistory: [...] }
// Returns: { reply: string, sources: [] }
app.post("/api/brain", async (req, res) => {
  const { messages, conversationHistory = [] } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ error: "messages required" });

  try {
    // Assemble live context
    const liveContext = await assembleBrainContext();

    const systemPrompt = `You are the Operative Marketing Brain — an AI intelligence layer for Chris Hession, VP of Global Marketing at Operative.

## About Operative
Operative sells:
- **AOS (Ad Operating System / Audience Operating System)** — the OMS for digital media, premium publishers, and streaming platforms. Replaces manual order management, GAM reconciliation, and fragmented yield ops.
- **STAQ** — analytics and data unification platform. Connects revenue data across GAM, SSPs, programmatic, and direct to give a clean yield view.
- **Adeline AI** — agentic AI layer that sits on top of AOS. Automates deal decisioning, pacing, and audience activation.
- **OnAir** — linear ad management for broadcast TV.

## Target Customers
Enterprise broadcasters, premium publishers, streaming platforms, sports media, and growth-stage digital media companies. Key verticals: CTV/streaming, sports DTC, digital news, DOOH, retail media.

## Competitors
Boostr, Fattail, Advendio, Placements.io, WideOrbit, Mediagenix.

## Your Role
You help Chris with:
- Market and competitive intelligence
- Campaign performance analysis
- Prospect research and ICP scoring
- Content drafting (LinkedIn posts, emails, blog posts)
- Pipeline strategy and deal coaching
- Marketing planning and positioning

## Live Data Available
${liveContext ? liveContext : "Context layer is loading. Answer from your training knowledge."}

## Instructions
- Be direct, specific, and actionable. No filler. No em-dashes.
- When you use web search, cite sources inline.
- For drafting tasks (LinkedIn, email), produce the full draft ready to use.
- For analysis tasks, lead with the insight, then the supporting data.
- If asked about pipeline or Salesforce data, note that Salesforce integration is coming soon.`;

    // Call Anthropic with web_search tool enabled
    const anthropicBody = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        }
      ],
      messages: [
        ...conversationHistory,
        ...messages,
      ],
    };

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await r.json();

    if (data.error) {
      console.error("[brain] Anthropic error:", data.error);
      return res.status(500).json({ error: data.error.message });
    }

    // Extract text content (may include tool use blocks)
    const textBlocks = (data.content || []).filter(b => b.type === "text");
    const reply = textBlocks.map(b => b.text).join("\n\n");

    // If the model used web_search, we need to continue the conversation to get the final answer
    const usedSearch = (data.content || []).some(b => b.type === "tool_use");
    if (usedSearch && data.stop_reason === "tool_use") {
      // Send tool results back and get final answer
      const toolUseBlocks = (data.content || []).filter(b => b.type === "tool_use");
      const toolResults = toolUseBlocks.map(b => ({
        type: "tool_result",
        tool_use_id: b.id,
        content: b.type === "tool_use" ? "Search completed" : "",
      }));

      const continueBody = {
        ...anthropicBody,
        messages: [
          ...anthropicBody.messages,
          { role: "assistant", content: data.content },
          { role: "user", content: toolResults },
        ],
      };

      const r2 = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "web-search-2025-03-05",
        },
        body: JSON.stringify(continueBody),
      });

      const data2 = await r2.json();
      const finalText = (data2.content || []).filter(b => b.type === "text").map(b => b.text).join("\n\n");
      return res.json({ reply: finalText || reply, usedSearch: true });
    }

    res.json({ reply: reply || "I could not generate a response. Please try again.", usedSearch });
  } catch (err) {
    console.error("[brain] error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Fallback ───────────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Operative Marketing OS running on port ${PORT}`);
});
