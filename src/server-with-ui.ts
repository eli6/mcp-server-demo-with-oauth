import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerUIEnabledTools } from "./tools/ui-enabled.js";
import { createAuthMiddleware, AuthConfig } from "./lib/auth.js";
import { registerOAuthEndpoints, OAuthConfig } from "./lib/oauth-metadata.js";

// Config
const PORT = parseInt(process.env.PORT || "3000", 10);
const OAUTH_SERVER_URL = process.env.OAUTH_SERVER_URL || "http://localhost:3001";
const DISABLE_AUTH = String(process.env.DISABLE_AUTH || "").toLowerCase() === "true" || process.env.DISABLE_AUTH === "1";
const AUTH_TOKEN_MODE = (process.env.AUTH_TOKEN_MODE || "introspection").toLowerCase() as "introspection" | "jwt";
const OAUTH_INTROSPECT_URL = process.env.OAUTH_INTROSPECT_URL || `${OAUTH_SERVER_URL}/introspect`;
const JWT_ISSUER = process.env.JWT_ISSUER; // e.g., https://your-tenant.auth0.com/
const JWT_AUDIENCE = process.env.JWT_AUDIENCE; // expected aud/resource, optional depending on IdP
const JWT_JWKS_URL = process.env.JWT_JWKS_URL || (JWT_ISSUER ? `${JWT_ISSUER.replace(/\/$/, "")}/.well-known/jwks.json` : undefined);
const SCOPES_SUPPORTED = ["mcp:tools", "openid", "profile", "email"];

// Auth configuration
const authConfig: AuthConfig = {
  DISABLE_AUTH,
  AUTH_TOKEN_MODE,
  OAUTH_INTROSPECT_URL,
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_JWKS_URL
};

// OAuth configuration
const oauthConfig: OAuthConfig = {
  OAUTH_SERVER_URL,
  SCOPES_SUPPORTED
};


const app = express();
// Respect X-Forwarded-* headers from reverse proxies (so req.protocol becomes https)
app.use(express.json());
app.use(cors({ origin: "*", exposedHeaders: ["Mcp-Session-Id"] }));

// Simple request logger
app.use((req, _res, next) => {
  const hasAuth = req.headers.authorization ? "yes" : "no";
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} auth:${hasAuth} accept:${req.headers['accept'] || ''}`);
  next();
});

// Register OAuth metadata endpoints
registerOAuthEndpoints(app, oauthConfig);

// Optional Bearer auth middleware (only for MCP endpoints)
app.use(createAuthMiddleware(authConfig));

// Build MCP server instance with UI
function buildMcp() {
  const mcp = new McpServer({ 
    name: "minimal-mcp", 
    version: "0.1.0"
  }, { 
    capabilities: { logging: {} } 
  });

  // Register UI resources
  mcp.registerResource(
    "greet-ui",
    "ui://widget/greet.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://widget/greet.html",
          mimeType: "text/html+skybridge",
          text: `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Greet</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 16px; }
      .card { border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06); padding: 16px; }
      .row { display: flex; gap: 8px; align-items: center; }
      input { flex: 1; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; }
      button { padding: 8px 12px; border: none; background: #111827; color: white; border-radius: 8px; cursor: pointer; }
      button:disabled { opacity: 0.6; cursor: default; }
      .greeting { margin-top: 12px; color: #111827; font-weight: 500; }
      .hint { color: #6b7280; font-size: 12px; margin-top: 8px; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="row">
        <input id="name" type="text" placeholder="Enter your name" />
        <button id="go">Greet</button>
      </div>
      <div id="out" class="greeting"></div>
      <div class="hint">Tip: This component can call the greet tool directly when supported.</div>
    </div>
    <script>
      const out = document.getElementById('out');
      const input = document.getElementById('name');
      const btn = document.getElementById('go');

      // Render initial greeting if provided
      try {
        const initial = (window.openai && window.openai.toolOutput) || {};
        if (initial && initial.greeting) {
          out.textContent = initial.greeting;
        }
        if (initial && initial.name) {
          input.value = initial.name;
        }
      } catch (_) {}

      async function callGreet(name) {
        if (window.openai && window.openai.callTool) {
          btn.disabled = true;
          try {
            const res = await window.openai.callTool('greet', { name });
            // Prefer structuredContent first; fall back to content text
            if (res && res.structuredContent && res.structuredContent.greeting) {
              out.textContent = res.structuredContent.greeting;
            } else if (Array.isArray(res?.content) && res.content[0]?.text) {
              out.textContent = res.content[0].text;
            } else {
              out.textContent = 'Hello, ' + name + '!';
            }
          } catch (e) {
            out.textContent = 'Error: ' + (e?.message || e);
          } finally {
            btn.disabled = false;
          }
        } else {
          // Fallback if component-initiated calls are unavailable
          out.textContent = 'Hello, ' + name + '!';
        }
      }

      btn.addEventListener('click', () => {
        const name = (input.value || '').trim();
        if (!name) {
          out.textContent = 'Please enter a name.';
          return;
        }
        callGreet(name);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          btn.click();
        }
      });
    </script>
  </body>
</html>
          `.trim(),
          _meta: {
            "openai/widgetPrefersBorder": true
          }
        }
      ]
    })
  );

  registerUIEnabledTools(mcp);
  return mcp;
}

// Session map
const transports: Record<string, StreamableHTTPServerTransport> = {};

// POST /mcp (JSON-RPC)
app.post("/mcp", async (req: Request, res: Response) => {
  // Clients must accept both (per Streamable HTTP)
  const accept = String(req.headers["accept"] || "");
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    console.warn(`[mcp] 406 Not Acceptable: accept="${accept}"`);
    return res.status(406).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Not Acceptable: Client must accept both application/json and text/event-stream"
      },
      id: null
    });
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    if (sessionId && transports[sessionId]) {
      const t = transports[sessionId];
      await t.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      // Allow client to provide session ID for persistence across restarts
      const requestedSessionId = req.headers["mcp-session-id"] as string | undefined;
      const t = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => requestedSessionId || randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = t;
        }
      });

      t.onclose = () => {
        const sid = t.sessionId;
        if (sid) delete transports[sid];
      };

      const mcp = buildMcp();
      await mcp.connect(t);
      await t.handleRequest(req, res, req.body);
      return;
    }

    // No session or not initialize
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      id: null
    });
  } catch (e: any) {
    console.error("Error handling /mcp:", e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// GET /mcp (SSE)
app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) return res.status(400).send("Invalid or missing session ID");
  const t = transports[sessionId];
  await t.handleRequest(req, res);
});

// DELETE /mcp (terminate)
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) return res.status(400).send("Invalid or missing session ID");
  const t = transports[sessionId];
  await t.handleRequest(req, res);
});


// Simple info page for testing
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>MCP Server with UI</title></head>
      <body>
        <h1>MCP Server with UI Components</h1>
        <p>This is the MCP server with OAuth integration and UI components.</p>
        <p>OAuth server runs separately on port 3001.</p>
        <h2>MCP Endpoints:</h2>
        <ul>
          <li><a href="/.well-known/oauth-authorization-server">OAuth Authorization Server Metadata</a></li>
          <li><a href="/.well-known/oauth-protected-resource">OAuth Protected Resource Metadata</a></li>
          <li><a href="${OAUTH_SERVER_URL}">OAuth Server (Port 3001)</a></li>
        </ul>
        <h2>MCP Endpoint:</h2>
        <ul>
          <li><code>POST /mcp</code> - MCP JSON-RPC endpoint</li>
          <li><code>GET /mcp</code> - MCP SSE stream</li>
        </ul>
        <h2>UI Components:</h2>
        <ul>
          <li><code>greet</code> tool renders an interactive greeting component</li>
        </ul>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 MCP server with UI listening on http://localhost:${PORT}/mcp`);
  console.log(`📋 OAuth metadata at: http://localhost:${PORT}/.well-known/oauth-authorization-server`);
  console.log(`🔒 Protected resource metadata at: http://localhost:${PORT}/.well-known/oauth-protected-resource`);
  console.log(`ℹ️  Info page at: http://localhost:${PORT}/`);
  console.log(`🔐 OAuth server: ${OAUTH_SERVER_URL}`);
  if (!DISABLE_AUTH) {
    if (AUTH_TOKEN_MODE === "jwt") {
      console.log(`✅ Using JWT validation via JWKS (${JWT_JWKS_URL || "(derived from issuer)"})`);
    } else {
      console.log(`✅ Using OAuth introspection at ${OAUTH_INTROSPECT_URL}`);
    }
  } else {
    console.log(`⚠️  OAuth disabled - no authentication required`);
  }
});
