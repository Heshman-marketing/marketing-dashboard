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
const GA_PROPERTY_ID    = process.env.GA_PROPERTY_ID;    // e.g. "properties/123456789"
const GA_CLIENT_ID      = process.env.GA_CLIENT_ID;
const GA_CLIENT_SECRET  = process.env.GA_CLIENT_SECRET;
const GA_REFRESH_TOKEN  = process.env.GA_REFRESH_TOKEN;
const WP_URL            = process.env.WP_URL || "https://www.operative.com";
const WP_USERNAME       = process.env.WP_USERNAME;
const WP_APP_PASSWORD   = process.env.WP_APP_PASSWORD;
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
  try {
    // Fetch all emails from HubSpot and match by name
    // Hardcoded email IDs (verified via /api/debug/email-names)
    const emails = [
      { name: "AOS Nurture Email 1", id: "209930076194", group: "AOS" },
      { name: "AOS Nurture Email 2", id: "209930191703", group: "AOS" },
      { name: "AOS Nurture Email 3", id: "209930208573", group: "AOS" },
      { name: "STAQ Nurture Email 1", id: "210411155104", group: "STAQ" },
      { name: "STAQ Nurture Email 2", id: "210407639089", group: "STAQ" },
      { name: "STAQ Nurture Email 3", id: "210407658574", group: "STAQ" },
    ];
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
// Uses OAuth2 refresh token. Returns null if GA is not configured.
let _gaAccessToken = null;
let _gaTokenExpiry = 0;

async function getGAAccessToken() {
  if (_gaAccessToken && Date.now() < _gaTokenExpiry) return _gaAccessToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GA_CLIENT_ID,
      client_secret: GA_CLIENT_SECRET,
      refresh_token: GA_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to get GA access token: " + JSON.stringify(data));
  _gaAccessToken = data.access_token;
  _gaTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _gaAccessToken;
}

async function fetchGAMetrics() {
  if (!GA_PROPERTY_ID || !GA_CLIENT_ID || !GA_CLIENT_SECRET || !GA_REFRESH_TOKEN) return null;
  try {
    const token = await getGAAccessToken();

    const [overviewRes, pagesRes, sourceRes] = await Promise.all([
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
      fetch(`https://analyticsdata.googleapis.com/v1beta/${GA_PROPERTY_ID}:runReport`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }, { name: "conversions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 8,
        }),
      }),
    ]);

    const overviewData = await overviewRes.json();
    const pagesData = await pagesRes.json();
    const sourceData = await sourceRes.json();

    const row = overviewData.rows?.[0]?.metricValues || [];
    const overview = {
      sessions: parseInt(row[0]?.value || "0").toLocaleString(),
      users: parseInt(row[1]?.value || "0").toLocaleString(),
      pageviews: parseInt(row[2]?.value || "0").toLocaleString(),
      conversions: parseInt(row[3]?.value || "0").toLocaleString(),
      bounceRate: row[4]?.value ? (parseFloat(row[4].value) * 100).toFixed(1) + "%" : "n/a",
      avgSessionDuration: row[5]?.value ? Math.round(parseFloat(row[5].value)) + "s" : "n/a",
    };

    const topPages = (pagesData.rows || []).map(r => ({
      page: r.dimensionValues[0]?.value,
      views: parseInt(r.metricValues[0]?.value || "0").toLocaleString(),
      sessions: parseInt(r.metricValues[1]?.value || "0").toLocaleString(),
    }));

    const channels = (sourceData.rows || []).map(r => ({
      channel: r.dimensionValues[0]?.value,
      sessions: parseInt(r.metricValues[0]?.value || "0").toLocaleString(),
      conversions: parseInt(r.metricValues[1]?.value || "0").toLocaleString(),
    }));

    return { overview, topPages, channels, period: "last 30 days" };
  } catch (err) {
    console.error("[GA] error:", err.message);
    return null;
  }
}

// ── Context assembly for Marketing Brain ──────────────────────────────────────
async function assembleBrainContext() {
  const parts = [];

  // 1. Context layer files — fetch all files dynamically
  try {
    const listRes = await fetch(`${CONTEXT_SERVICE_URL}/files`);
    if (listRes.ok) {
      const fileList = await listRes.json();
      // Flatten all sections into a single list of paths
      const allPaths = Object.values(fileList).flat().map(f => f.path || f);
      // Fetch all files in parallel, skip learnings (handled separately below)
      const nonLearnings = allPaths.filter(p => !p.startsWith('learnings/'));
      const fileResults = await Promise.all(
        nonLearnings.map(p =>
          fetch(`${CONTEXT_SERVICE_URL}/file?path=${encodeURIComponent(p)}`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
      );
      for (const d of fileResults) {
        if (d?.content) parts.push(d.content);
      }
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
    // Fetch all marketing emails. We'll filter by publishDate after fetching.
    const allEmails = [];
    let after = null;
    do {
      const qs = `limit=50&orderBy=-publishDate${after ? `&after=${after}` : ""}`;
      const r = await fetch(`https://api.hubapi.com/marketing/v3/emails?${qs}`, {
        headers: { "Authorization": `Bearer ${HUBSPOT_API_KEY}` },
      });
      if (!r.ok) break;
      const data = await r.json();
      const batch = data.results || [];
      allEmails.push(...batch);
      after = data.paging?.next?.after || null;
      // Stop once we hit emails published more than 18 months ago
      const oldest = batch[batch.length - 1];
      if (oldest?.publishDate && new Date(oldest.publishDate) < new Date(Date.now() - 18 * 30 * 24 * 60 * 60 * 1000)) break;
    } while (after && allEmails.length < 200);
    
    // Always ensure our core nurture emails are included by fetching them directly
    const coreIds = ["209930076194","209930191703","209930208573","210411155104","210407639089","210407658574"];
    const existingIds = new Set(allEmails.map(e => String(e.id)));
    const missing = coreIds.filter(id => !existingIds.has(id));
    if (missing.length) {
      const coreResults = await Promise.all(missing.map(async id => {
        const r = await fetch(`https://api.hubapi.com/marketing/v3/emails/${id}`, {
          headers: { "Authorization": `Bearer ${HUBSPOT_API_KEY}` },
        });
        return r.ok ? r.json() : null;
      }));
      allEmails.push(...coreResults.filter(Boolean));
    }

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
      const sentDate = email.publishDate || email.updatedAt || email.createdAt || "";
      const dateStr = sentDate ? ` (${new Date(sentDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })})` : "";
      return `${name}${dateStr}: ${sent} sent, ${denom > 0 ? ((opened/denom)*100).toFixed(1) : 0}% open, ${denom > 0 ? ((clicked/denom)*100).toFixed(1) : 0}% CTR`;
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
      const { overview, topPages, channels } = ga;
      const topPagesStr = topPages.map(p => `  ${p.page} — ${p.views} views, ${p.sessions} sessions`).join("\n");
      const channelsStr = channels ? channels.map(c => `  ${c.channel}: ${c.sessions} sessions, ${c.conversions} conversions`).join("\n") : "";
      parts.push(
        `## Website Analytics (Last 30 Days)\n` +
        `Sessions: ${overview.sessions} | Users: ${overview.users} | Pageviews: ${overview.pageviews}\n` +
        `Conversions: ${overview.conversions} | Bounce rate: ${overview.bounceRate} | Avg session: ${overview.avgSessionDuration}\n` +
        `\nTop Pages:\n${topPagesStr}` +
        (channelsStr ? `\n\nTraffic by Channel:\n${channelsStr}` : "")
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

// ── GA Analytics Agent endpoint ───────────────────────────────────────────────
// POST /api/ga-report
// Body: { startDate, endDate, metrics?, dimensions? }
// startDate/endDate: "YYYY-MM-DD" or GA4 relative dates like "30daysAgo", "today"
app.post("/api/ga-report", async (req, res) => {
  const {
    startDate = "30daysAgo",
    endDate = "today",
    pageFilter = null,       // optional: filter to a specific page path prefix
    channelFilter = null,    // optional: filter to a specific channel
  } = req.body || {};

  if (!GA_PROPERTY_ID || !GA_CLIENT_ID || !GA_CLIENT_SECRET || !GA_REFRESH_TOKEN) {
    return res.status(503).json({ error: "GA not configured" });
  }

  try {
    const token = await getGAAccessToken();
    const dateRange = [{ startDate, endDate }];

    // Build optional dimension filters
    const makeFilter = (field, value) => ({
      filter: { fieldName: field, stringFilter: { matchType: "BEGINS_WITH", value } }
    });

    // 1. Overview metrics
    const overviewBody = {
      dateRanges: dateRange,
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "newUsers" },
        { name: "screenPageViews" },
        { name: "conversions" },
        { name: "bounceRate" },
        { name: "averageSessionDuration" },
        { name: "engagementRate" },
      ],
    };
    if (channelFilter) overviewBody.dimensionFilter = makeFilter("sessionDefaultChannelGroup", channelFilter);

    // 2. Top pages
    const pagesBody = {
      dateRanges: dateRange,
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [{ name: "screenPageViews" }, { name: "sessions" }, { name: "averageSessionDuration" }, { name: "bounceRate" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 20,
    };
    if (pageFilter) pagesBody.dimensionFilter = makeFilter("pagePath", pageFilter);

    // 3. Traffic channels
    const channelsBody = {
      dateRanges: dateRange,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "conversions" }, { name: "bounceRate" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    };

    // 4. Daily trend (sessions over time)
    const trendBody = {
      dateRanges: dateRange,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "screenPageViews" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    };

    // 5. Devices
    const devicesBody = {
      dateRanges: dateRange,
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    };

    const gaPost = (body) => fetch(`https://analyticsdata.googleapis.com/v1beta/${GA_PROPERTY_ID}:runReport`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(r => r.json());

    const [overviewData, pagesData, channelsData, trendData, devicesData] = await Promise.all([
      gaPost(overviewBody),
      gaPost(pagesBody),
      gaPost(channelsBody),
      gaPost(trendBody),
      gaPost(devicesBody),
    ]);

    // Parse overview
    const ov = overviewData.rows?.[0]?.metricValues || [];
    const fmt = (v, decimals = 0) => parseFloat(v || "0").toLocaleString("en-US", { maximumFractionDigits: decimals });
    const pct = (v) => (parseFloat(v || "0") * 100).toFixed(1) + "%";
    const dur = (v) => {
      const s = Math.round(parseFloat(v || "0"));
      const m = Math.floor(s / 60); const sec = s % 60;
      return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
    };

    const overview = {
      sessions: fmt(ov[0]?.value),
      users: fmt(ov[1]?.value),
      newUsers: fmt(ov[2]?.value),
      pageviews: fmt(ov[3]?.value),
      conversions: fmt(ov[4]?.value),
      bounceRate: pct(ov[5]?.value),
      avgDuration: dur(ov[6]?.value),
      engagementRate: pct(ov[7]?.value),
    };

    // Parse pages
    const pages = (pagesData.rows || []).map(r => ({
      path: r.dimensionValues[0]?.value,
      title: r.dimensionValues[1]?.value,
      views: fmt(r.metricValues[0]?.value),
      sessions: fmt(r.metricValues[1]?.value),
      avgDuration: dur(r.metricValues[2]?.value),
      bounceRate: pct(r.metricValues[3]?.value),
    }));

    // Parse channels
    const channels = (channelsData.rows || []).map(r => ({
      channel: r.dimensionValues[0]?.value,
      sessions: fmt(r.metricValues[0]?.value),
      users: fmt(r.metricValues[1]?.value),
      conversions: fmt(r.metricValues[2]?.value),
      bounceRate: pct(r.metricValues[3]?.value),
      sessionsPct: null, // filled below
    }));
    const totalSessions = (channelsData.rows || []).reduce((s, r) => s + parseInt(r.metricValues[0]?.value || 0), 0);
    channels.forEach(c => {
      c.sessionsPct = totalSessions > 0 ? ((parseInt(c.sessions.replace(/,/g, "")) / totalSessions) * 100).toFixed(1) + "%" : "0%";
    });

    // Parse daily trend
    const trend = (trendData.rows || []).map(r => {
      const d = r.dimensionValues[0]?.value || "";
      return {
        date: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`,
        sessions: parseInt(r.metricValues[0]?.value || "0"),
        pageviews: parseInt(r.metricValues[1]?.value || "0"),
      };
    });

    // Parse devices
    const devices = (devicesData.rows || []).map(r => ({
      device: r.dimensionValues[0]?.value,
      sessions: fmt(r.metricValues[0]?.value),
      users: fmt(r.metricValues[1]?.value),
    }));

    res.json({ overview, pages, channels, trend, devices, dateRange: { startDate, endDate } });
  } catch (err) {
    console.error("[ga-report]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Debug: list all HubSpot email names ──────────────────────────────────────
app.get("/api/debug/email-names", async (req, res) => {
  try {
    const names = ["AOS Nurture Email 1","AOS Nurture Email 2","AOS Nurture Email 3","STAQ Nurture Email 1","STAQ Nurture Email 2","STAQ Nurture Email 3"];
    const results = await Promise.all(names.map(async name => {
      const r = await fetch("https://api.hubapi.com/marketing/v3/emails?limit=5&name=" + encodeURIComponent(name), {
        headers: { "Authorization": "Bearer " + HUBSPOT_API_KEY },
      });
      const d = await r.json();
      return { searching: name, found: (d.results||[]).map(e => ({ id: e.id, name: e.name })) };
    }));
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Recent email metrics — last 5 sent emails ────────────────────────────────
app.get("/api/email-metrics/recent", async (req, res) => {
  const limit = parseInt(req.query.limit) || 5;
  try {
    // Fetch all emails ordered by publish date descending
    const allEmails = [];
    let after = null;
    do {
      const qs = `limit=50&orderBy=-publishDate${after ? `&after=${after}` : ""}`;
      const r = await fetch(`https://api.hubapi.com/marketing/v3/emails?${qs}`, {
        headers: { "Authorization": `Bearer ${HUBSPOT_API_KEY}` },
      });
      if (!r.ok) break;
      const data = await r.json();
      allEmails.push(...(data.results || []));
      after = data.paging?.next?.after || null;
      // Stop once we have enough candidates or hit 6 months ago
      const oldest = allEmails[allEmails.length - 1];
      if (oldest?.publishDate && new Date(oldest.publishDate) < new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)) break;
    } while (after && allEmails.length < 100);

    // Get stats for each and filter to ones with actual sends
    const withStats = await Promise.all(allEmails.map(async (email) => {
      let sent = 0, delivered = 0, opened = 0, clicked = 0;

      // Try stats endpoint first
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

      // Fallback: counters on email object
      if (!sent) {
        const c = email.counters || {};
        sent = c.sent || c.SENT || 0;
        delivered = c.delivered || c.DELIVERED || 0;
        opened = c.open || c.opens || 0;
        clicked = c.click || c.clicks || 0;
      }

      // Fallback: campaign IDs
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
      return {
        id: email.id,
        name: email.name || email.subject || `Email ${email.id}`,
        subject: email.subject || email.name || "",
        publishDate: email.publishDate || email.updatedAt || null,
        sent,
        delivered,
        opened,
        clicked,
        openRate: denom > 0 ? ((opened / denom) * 100).toFixed(1) : "0.0",
        clickRate: denom > 0 ? ((clicked / denom) * 100).toFixed(1) : "0.0",
      };
    }));

    const results = withStats.filter(Boolean).slice(0, limit);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Blog Agent ────────────────────────────────────────────────────────────────

// POST /api/blog/generate
// Body: { topic, type, keyword, angle, notes }
app.post("/api/blog/generate", async (req, res) => {
  const { topic, type = "thought-leadership", keyword = "", angle = "", notes = "", wordCount = "" } = req.body || {};
  if (!topic) return res.status(400).json({ error: "topic required" });

  try {
    // Assemble context
    const contextParts = [];
    try {
      const [globalRes, aosRes, staqRes] = await Promise.all([
        fetch(`${CONTEXT_SERVICE_URL}/file?path=global/operative-products.md`),
        fetch(`${CONTEXT_SERVICE_URL}/file?path=agents/aos-nurture.md`),
        fetch(`${CONTEXT_SERVICE_URL}/file?path=agents/staq-prospecting.md`),
      ]);
      for (const r of [globalRes, aosRes, staqRes]) {
        if (r.ok) { const d = await r.json(); if (d.content) contextParts.push(d.content); }
      }
    } catch {}

    // Recent competitive learnings for context
    try {
      const r = await fetch(`${CONTEXT_SERVICE_URL}/learnings-list`);
      if (r.ok) {
        const entries = await r.json();
        const recent = entries.slice(0, 5).map(e => `${e.date} — ${e.agent}: ${e.note.slice(0, 200)}`).join("\n");
        if (recent) contextParts.push(`Recent intelligence:\n${recent}`);
      }
    } catch {}

    const contextBlock = contextParts.join("\n\n---\n\n");

    const typeDescriptions = {
      "thought-leadership": "a thought leadership post that positions Operative as an authority on ad tech, media monetization, and the Audience Economy. Lead with a strong POV, use data and examples, write in a direct and confident voice.",
      "product-announcement": "a product or feature announcement post. Lead with the problem it solves, explain what's new and why it matters, include a clear call to action.",
      "seo": `an SEO-driven post targeting the keyword "${keyword}". Structure it for search intent with a clear H1 containing the keyword, supporting H2s, and a meta description under 160 characters.`,
      "campaign": "a campaign-aligned post that supports the current go-to-market motion. Tie it to a specific audience pain point and include a clear call to action.",
    };

    const typeDesc = typeDescriptions[type] || typeDescriptions["thought-leadership"];

    const prompt = `You are the VP of Marketing at Operative, a B2B ad tech company, writing a blog post for the Operative website.

Operative sells:
- AOS (Ad Operating System) — the OMS for digital media, premium publishers, and streaming platforms
- STAQ — analytics and data unification for media companies
- Adeline AI — agentic AI layer for automated deal decisioning
- OnAir — linear ad management for broadcast TV

Target audience: C-suite and VP-level executives who run media companies — broadcasters, premium publishers, streaming platforms, sports media, and digital-native media businesses.

WRITING STYLE — follow these rules precisely:

1. PROFESSIONAL THOUGHT LEADERSHIP: Write as a senior practitioner with genuine authority. Every sentence earns its place. No filler, no hedging, no corporate-speak. This should read like it was written by someone who has spent years inside media companies and understands the real operational and strategic pressures they face.

2. PRACTICAL AND SPECIFIC: Provide actionable steps and real-world examples. Break complex ideas into concrete, doable actions. When citing examples or data, include source context. Go deeper than the reader expects — be thought-provoking and intellectually rigorous.

3. URGENCY WITHOUT ALARM: Communicate the cost of inaction while keeping the message forward-looking and positive. Highlight time-sensitive opportunities without being alarmist.

4. STRATEGIC REPETITION: Use variations of the same core idea to drive the point home. Create memorable phrases that stick. Reinforce the central argument from multiple angles so it lands.

5. DIRECT BUT REFRAMED: Engage the audience directly but frame insights around media companies as a category. Use "you" or "your company" sparingly and intentionally — not in every paragraph.

6. CONTRAST FOR IMPACT: Juxtapose old thinking with new perspectives. Highlight the difference between action and inaction. Compare short-term discomfort with long-term competitive advantage.

7. VISUAL STRUCTURE: Use clear H2 and H3 headings. Well-organized and scannable. Go into more detail than expected. Each section should deliver genuine insight, not just restate the obvious.

8. STRONG CLOSE: End with a clear, actionable call-to-action. Encourage immediate implementation. Invite engagement.

STRICT PROHIBITIONS:
- No em-dashes under any circumstances (restructure the sentence, use a colon, or use a comma instead)
- No emoji
- No hashtags
- No generic marketing language: "game-changer," "revolutionary," "unlock," "leverage," "delve," "navigate," "landscape," "seamless," "cutting-edge," "robust"
- Minimize passive voice
- Never use "In my role as," "In my experience as," "As VP of Marketing," "As someone who," or any variant that explicitly references the author's position or role — the authority should come through in the writing itself, not stated
- No italics — never use <em> or <i> tags in the HTML output

${contextBlock ? `CONTEXT FROM KNOWLEDGE BASE:\n${contextBlock.slice(0, 4000)}\n\n` : ""}

Write ${typeDesc}

Topic: ${topic}
${angle ? `Angle / POV: ${angle}` : ""}
${keyword ? `Target keyword: ${keyword}` : ""}
${notes ? `Additional notes: ${notes}` : ""}

WORD COUNT REQUIREMENT: ` + (wordCount ? ("The post body MUST be approximately " + wordCount + " words. Count carefully. Do not submit fewer than " + Math.round(parseInt(wordCount) * 0.9) + " words.") : "The post body MUST be at least 800 words. Do not submit fewer than 800 words.") + `

ABSOLUTE HTML RULES FOR THE BODY FIELD — NO EXCEPTIONS:
- Use <h2> and <h3> for section headings
- Use <p> for all paragraphs
- Use <ul>/<li> for bullet lists
- Use <strong> for emphasis only where it genuinely adds value
- NEVER use <em> or <i> tags — not once, not ever
- NEVER use <html>, <head>, <body>, or any wrapper tags
- NEVER use inline styles
- Every sentence that needs emphasis gets <strong>, never <em>

Return a JSON object with exactly these fields:
{
  "title": "The post title (compelling, specific, authoritative — under 70 chars)",
  "metaDescription": "SEO meta description under 160 chars — clear and compelling, no hype",
  "slug": "url-friendly-slug-from-title",
  "tags": ["tag1", "tag2", "tag3"],
  "categories": ["suggested category name"],
  "estimatedReadTime": "X min read",
  "body": "REQUIRED: Full HTML post body meeting all rules above. Hit the word count target exactly."
}

Return ONLY valid JSON. No preamble, no markdown code fences.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    // Extract text content (may have gone through tool use)
    let text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n\n");

    // If tool use occurred, continue conversation
    if (data.stop_reason === "tool_use") {
      const toolUseBlocks = (data.content || []).filter(b => b.type === "tool_use");
      const toolResults = toolUseBlocks.map(b => ({ type: "tool_result", tool_use_id: b.id, content: "Search completed" }));
      const r2 = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "web-search-2025-03-05" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 4000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: prompt }, { role: "assistant", content: data.content }, { role: "user", content: toolResults }],
        }),
      });
      const data2 = await r2.json();
      text = (data2.content || []).filter(b => b.type === "text").map(b => b.text).join("\n\n");
    }

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: "Could not parse post from AI response", raw: text.slice(0, 500) });
    const post = JSON.parse(jsonMatch[0]);

    // Strip any <em> and <i> tags — replace with their text content (no italics policy)
    // Use a loop to handle nested/multiline cases
    if (post.body) {
      let prev = "";
      while (prev !== post.body) {
        prev = post.body;
        post.body = post.body
          .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "$1")
          .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "$1");
      }
    }

    res.json(post);
  } catch (err) {
    console.error("[blog/generate]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/blog/publish
// Body: { title, body, slug, metaDescription, tags, categories, status }
// status: 'draft' (default) or 'publish'
app.post("/api/blog/publish", async (req, res) => {
  const { title, body, slug, metaDescription, tags = [], categories = [], status = "draft" } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: "title and body required" });
  if (!WP_USERNAME || !WP_APP_PASSWORD) return res.status(503).json({ error: "WordPress credentials not configured. Add WP_USERNAME and WP_APP_PASSWORD to Railway env vars." });

  try {
    const credentials = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString("base64");
    const wpBase = `${WP_URL}/wp-json/wp/v2`;

    // Resolve or create tags
    const tagIds = await Promise.all(tags.map(async (tagName) => {
      try {
        // Search for existing tag
        const searchRes = await fetch(`${wpBase}/tags?search=${encodeURIComponent(tagName)}`, {
          headers: { "Authorization": `Basic ${credentials}` },
        });
        const existing = await searchRes.json();
        if (existing.length > 0) return existing[0].id;
        // Create new tag
        const createRes = await fetch(`${wpBase}/tags`, {
          method: "POST",
          headers: { "Authorization": `Basic ${credentials}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: tagName }),
        });
        const created = await createRes.json();
        return created.id;
      } catch { return null; }
    }));

    // Resolve or create categories
    const categoryIds = await Promise.all(categories.map(async (catName) => {
      try {
        const searchRes = await fetch(`${wpBase}/categories?search=${encodeURIComponent(catName)}`, {
          headers: { "Authorization": `Basic ${credentials}` },
        });
        const existing = await searchRes.json();
        if (existing.length > 0) return existing[0].id;
        const createRes = await fetch(`${wpBase}/categories`, {
          method: "POST",
          headers: { "Authorization": `Basic ${credentials}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: catName }),
        });
        const created = await createRes.json();
        return created.id;
      } catch { return null; }
    }));

    // Create the post
    const postBody = {
      title,
      content: body,
      status,
      slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      excerpt: metaDescription || "",
      tags: tagIds.filter(Boolean),
      categories: categoryIds.filter(Boolean),
      meta: { _yoast_wpseo_metadesc: metaDescription || "" },
    };

    const postRes = await fetch(`${wpBase}/posts`, {
      method: "POST",
      headers: { "Authorization": `Basic ${credentials}`, "Content-Type": "application/json" },
      body: JSON.stringify(postBody),
    });

    const postData = await postRes.json();
    if (!postRes.ok) return res.status(500).json({ error: postData.message || "WordPress API error", detail: postData });

    res.json({
      ok: true,
      id: postData.id,
      status: postData.status,
      editUrl: `${WP_URL}/wp-admin/post.php?post=${postData.id}&action=edit`,
      previewUrl: postData.link,
      title: postData.title?.rendered,
    });
  } catch (err) {
    console.error("[blog/publish]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Product Messaging Agent ───────────────────────────────────────────────────
// POST /api/messaging/generate
// Body: { product, audience, sourceMaterial, notes }
app.post("/api/messaging/generate", async (req, res) => {
  const { product, audience = "", sourceMaterial = "", notes = "" } = req.body || {};
  if (!product) return res.status(400).json({ error: "product required" });

  try {
    // Pull context layer for product info
    let contextBlock = "";
    try {
      const listRes = await fetch(`${CONTEXT_SERVICE_URL}/files`);
      if (listRes.ok) {
        const fileList = await listRes.json();
        const allPaths = Object.values(fileList).flat().map(f => f.path || f).filter(p => !p.startsWith("learnings/"));
        const fileResults = await Promise.all(
          allPaths.map(p => fetch(`${CONTEXT_SERVICE_URL}/file?path=${encodeURIComponent(p)}`).then(r => r.ok ? r.json() : null).catch(() => null))
        );
        contextBlock = fileResults.filter(Boolean).map(d => d.content || "").filter(Boolean).join("\n\n---\n\n").slice(0, 6000);
      }
    } catch {}

    const prompt = `You are creating a structured product messaging framework for Operative, a B2B media technology company.

ABOUT OPERATIVE:
- AOS: System of record and data layer for the audience economy
- Adeline: Embedded AI engine for automated deal decisioning and audience activation
- Operative One (also called "Operative.One"): Deal management and digital ad management platform
- Strategic narrative: Operative is "the system of record for the audience economy" — a structural shift in media from selling inventory to continuously monetizing audience value

BRAND VOICE:
- Plain-spoken and practical over polished and marketing-heavy
- The key insight: teams should build what differentiates them, not rebuild foundational infrastructure
- "Audience economy" is a category claim, not a passing reference — thread it through the framework
- No em-dashes. No italics. No generic marketing language.

${contextBlock ? "CONTEXT LAYER:\n" + contextBlock + "\n\n" : ""}
${sourceMaterial ? "SOURCE MATERIAL PROVIDED:\n" + sourceMaterial + "\n\n" : ""}

Generate a messaging framework for: ${product}
Target audience: ${audience || "Revenue Operations and Ad Ops leaders at premium publishers, broadcasters, and streaming platforms"}
${notes ? "Additional direction: " + notes : ""}

STRICT FORMAT REQUIREMENTS — follow word limits exactly:

POSITIONING (50 words maximum):
Use this sentence structure exactly:
"[PRODUCT] is a [DEFINITION] for [TARGET AUDIENCE] who need to [CHALLENGE]. Unlike [COMPETITIVE OFFERINGS], [PRODUCT] [DIFFERENTIATION] in order to [OUTCOME]."

KEY MESSAGE (8 words maximum):
Start with an action verb. Be bold and direct.

SUPPORTING MESSAGE (20 words maximum):
Start with an action verb. Expand on the key message with specificity.

THREE PILLARS — each pillar must have:
- Pillar name (3 words maximum)
- Customer Challenge (8 words maximum) — the specific pain point
- Benefit Statement (10 words maximum) — the value delivered
- Supporting Features (exactly 3 features, each with a name and a description of 12 words maximum)

Return ONLY a valid JSON object with this exact structure:
{
  "product": "${product}",
  "audience": "target audience description",
  "positioning": "positioning statement here",
  "keyMessage": "key message here",
  "supportingMessage": "supporting message here",
  "pillars": [
    {
      "pillar": "Pillar Name",
      "customerChallenge": "customer challenge text",
      "benefitStatement": "benefit statement text",
      "features": [
        {"name": "Feature Name", "description": "feature description up to 12 words"},
        {"name": "Feature Name", "description": "feature description up to 12 words"},
        {"name": "Feature Name", "description": "feature description up to 12 words"}
      ]
    },
    { ... },
    { ... }
  ]
}

Return ONLY valid JSON. No preamble, no markdown fences. Exactly 3 pillars, exactly 3 features each.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 3000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: "Could not parse framework", raw: text.slice(0, 500) });
    const framework = JSON.parse(jsonMatch[0]);
    res.json(framework);
  } catch (err) {
    console.error("[messaging/generate]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messaging/export
// Body: the framework JSON — returns a .docx file
app.post("/api/messaging/export", async (req, res) => {
  const framework = req.body;
  if (!framework?.product) return res.status(400).json({ error: "framework data required" });
  try {
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, BorderStyle, WidthType, ShadingType, Header, Footer, PageNumber
    } = require("docx");

    const NAVY="061A3D",ORANGE="FC5000",LGRAY="F5F6F8",MGRAY="E4E7ED",DGRAY="32415E",WHITE="FFFFFF",TEXT2="1A2333",MUTED="6B7A8D";
    const nb={style:BorderStyle.NONE,size:0,color:"FFFFFF"};
    const cb=(c=MGRAY)=>({style:BorderStyle.SINGLE,size:4,color:c});
    const cbs=(c=MGRAY)=>({top:cb(c),bottom:cb(c),left:cb(c),right:cb(c)});
    const sp=(b=0,a=0)=>({before:b,after:a});
    const tx=(text,{bold=false,color=TEXT2,size=20,italic=false}={})=>new TextRun({text,bold,color,size,font:"Arial",italics:italic});
    const pr=(children,{spacing=sp(0,100),alignment=AlignmentType.LEFT,border=null}={})=>new Paragraph({children,spacing,alignment,...(border?{border}:{})});

    const COL=3120;
    const pillarsTable=()=>new Table({
      width:{size:9360,type:WidthType.DXA},columnWidths:[COL,COL,COL],
      rows:[
        new TableRow({children:framework.pillars.map(p=>new TableCell({width:{size:COL,type:WidthType.DXA},borders:cbs(ORANGE),shading:{fill:NAVY,type:ShadingType.CLEAR},margins:{top:120,bottom:120,left:160,right:160},children:[pr([tx(p.pillar,{bold:true,color:WHITE,size:22})],{spacing:sp(0,0),alignment:AlignmentType.CENTER})]}))}),
        new TableRow({children:framework.pillars.map(p=>new TableCell({width:{size:COL,type:WidthType.DXA},borders:cbs(),shading:{fill:WHITE,type:ShadingType.CLEAR},margins:{top:120,bottom:120,left:160,right:160},children:[pr([tx("CUSTOMER CHALLENGE",{bold:true,color:ORANGE,size:14})],{spacing:sp(0,40)}),pr([tx(p.customerChallenge,{color:TEXT2,size:20})],{spacing:sp(0,0)})]}))}),
        new TableRow({children:framework.pillars.map(p=>new TableCell({width:{size:COL,type:WidthType.DXA},borders:cbs(),shading:{fill:LGRAY,type:ShadingType.CLEAR},margins:{top:120,bottom:120,left:160,right:160},children:[pr([tx("BENEFIT STATEMENT",{bold:true,color:ORANGE,size:14})],{spacing:sp(0,40)}),pr([tx(p.benefitStatement,{color:TEXT2,size:20})],{spacing:sp(0,0)})]}))}),
        new TableRow({children:framework.pillars.map(p=>new TableCell({width:{size:COL,type:WidthType.DXA},borders:cbs(),shading:{fill:WHITE,type:ShadingType.CLEAR},margins:{top:120,bottom:160,left:160,right:160},children:[pr([tx("SUPPORTING FEATURES",{bold:true,color:ORANGE,size:14})],{spacing:sp(0,60)}),...p.features.map(f=>pr([tx(f.name,{bold:true,color:NAVY,size:18}),tx(": ",{color:MUTED,size:18}),tx(f.description,{color:MUTED,size:18})],{spacing:sp(0,60)}))]}))})
      ]
    });

    const doc = new Document({
      sections:[{
        properties:{page:{size:{width:12240,height:15840},margin:{top:1080,right:1080,bottom:1080,left:1080}}},
        headers:{default:new Header({children:[pr([tx("Operative",{bold:true,color:NAVY,size:18}),tx(" · Messaging Framework — ",{color:MUTED,size:18}),tx(framework.product,{bold:true,color:ORANGE,size:18})],{spacing:sp(0,0),border:{bottom:{style:BorderStyle.SINGLE,size:4,color:MGRAY,space:4}}})]})},
        footers:{default:new Footer({children:[pr([tx("Operative — Confidential",{color:MUTED,size:16}),tx("	",{size:16}),tx("Page ",{color:MUTED,size:16}),new TextRun({children:[PageNumber.CURRENT],color:MUTED,size:16,font:"Arial"})],{spacing:sp(0,0),border:{top:{style:BorderStyle.SINGLE,size:4,color:MGRAY,space:4}}})]})},
        children:[
          pr([tx(framework.product,{bold:true,color:NAVY,size:52})],{spacing:sp(0,80)}),
          pr([tx("Messaging Framework",{color:ORANGE,size:28})],{spacing:sp(0,40)}),
          pr([tx(framework.audience||"",{color:MUTED,size:20})],{spacing:sp(0,0),border:{bottom:{style:BorderStyle.SINGLE,size:8,color:ORANGE,space:8}}}),
          pr([tx("")],{spacing:sp(0,240)}),
          pr([tx("Positioning",{bold:true,color:NAVY,size:28})],{spacing:sp(240,120)}),
          pr([tx("POSITIONING STATEMENT",{bold:true,color:ORANGE,size:14})],{spacing:sp(0,40)}),
          pr([tx(framework.positioning,{color:TEXT2,size:20})]),
          pr([tx("")],{spacing:sp(0,200)}),
          pr([tx("Key Message",{bold:true,color:NAVY,size:28})],{spacing:sp(240,120)}),
          new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[9360],rows:[new TableRow({children:[new TableCell({width:{size:9360,type:WidthType.DXA},borders:cbs(ORANGE),shading:{fill:NAVY,type:ShadingType.CLEAR},margins:{top:200,bottom:200,left:320,right:320},children:[pr([tx(framework.keyMessage,{bold:true,color:WHITE,size:28})],{spacing:sp(0,0),alignment:AlignmentType.CENTER})]})]})]}) ,
          pr([tx("")],{spacing:sp(0,200)}),
          pr([tx("Supporting Message",{bold:true,color:NAVY,size:28})],{spacing:sp(240,120)}),
          new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[9360],rows:[new TableRow({children:[new TableCell({width:{size:9360,type:WidthType.DXA},borders:cbs(MGRAY),shading:{fill:LGRAY,type:ShadingType.CLEAR},margins:{top:160,bottom:160,left:280,right:280},children:[pr([tx(framework.supportingMessage,{color:DGRAY,size:22})],{spacing:sp(0,0)})]})]})]}),
          pr([tx("")],{spacing:sp(0,200)}),
          pr([tx("Messaging Pillars",{bold:true,color:NAVY,size:28})],{spacing:sp(240,120)}),
          pillarsTable(),
        ]
      }]
    });

    const buf = await Packer.toBuffer(doc);
    const slug = framework.product.toLowerCase().replace(/[^a-z0-9]+/g,"-");
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition",`attachment; filename="operative-messaging-${slug}.docx"`);
    res.send(buf);
  } catch (err) {
    console.error("[messaging/export]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GA debug endpoint ─────────────────────────────────────────────────────────
app.get("/api/ga-test", async (req, res) => {
  try {
    if (!GA_CLIENT_ID || !GA_CLIENT_SECRET || !GA_REFRESH_TOKEN || !GA_PROPERTY_ID) {
      return res.json({ ok: false, error: "Missing env vars", vars: {
        GA_CLIENT_ID: !!GA_CLIENT_ID,
        GA_CLIENT_SECRET: !!GA_CLIENT_SECRET,
        GA_REFRESH_TOKEN: !!GA_REFRESH_TOKEN,
        GA_PROPERTY_ID: !!GA_PROPERTY_ID,
      }});
    }
    const token = await getGAAccessToken();
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${GA_PROPERTY_ID}:runReport`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
        metrics: [{ name: "sessions" }],
      }),
    });
    const data = await r.json();
    res.json({ ok: r.ok, status: r.status, data });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Fallback ───────────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Operative Marketing OS running on port ${PORT}`);
});
