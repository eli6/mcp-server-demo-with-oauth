import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
// Tool registration is determined by TOOL_MODE environment variable
// Options: "basic" (default), "ui-html", "ui-react"
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
app.set("trust proxy", true);
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

// Build MCP server instance
async function buildMcp() {
  const mcp = new McpServer({ 
    name: "minimal-mcp", 
    version: "0.1.0"
  }, { 
    capabilities: { logging: {} } 
  });

  // Dynamically import tool registration based on TOOL_MODE
  const TOOL_MODE = (process.env.TOOL_MODE || "basic").toLowerCase();
  let registerTools;
  
  if (TOOL_MODE === "ui-html") {
    registerTools = (await import("./tools/ui-html.js")).registerTools;
  } else if (TOOL_MODE === "ui-react") {
    registerTools = (await import("./tools/ui-react.js")).registerTools;
  } else {
    registerTools = (await import("./tools/basic.js")).registerTools;
  }

  registerTools(mcp);
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

      const mcp = await buildMcp();
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
  const TOOL_MODE = (process.env.TOOL_MODE || "basic").toLowerCase();
  const modeDescription = 
    TOOL_MODE === "ui-html" ? "with HTML UI components" :
    TOOL_MODE === "ui-react" ? "with React UI components" :
    "basic (no UI)";
  
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>MCP Server</title></head>
      <body>
        <h1>MCP Server</h1>
        <p>This is the MCP server with OAuth integration (${modeDescription}).</p>
        <p>OAuth server runs separately on port 3001.</p>
        <p><strong>Tool Mode:</strong> <code>${TOOL_MODE}</code></p>
        <h2>MCP Endpoints:</h2>
        <ul>
          <li><a href="/.well-known/oauth-protected-resource">OAuth Protected Resource Metadata</a></li>
          <li><a href="${OAUTH_SERVER_URL}">OAuth Server (Port 3001)</a></li>
        </ul>
        <h2>MCP Endpoint:</h2>
        <ul>
          <li><code>POST /mcp</code> - MCP JSON-RPC endpoint</li>
          <li><code>GET /mcp</code> - MCP SSE stream</li>
        </ul>
      </body>
    </html>
  `);
});

app.listen(PORT, '0.0.0.0', async () => {
  const TOOL_MODE = (process.env.TOOL_MODE || "basic").toLowerCase();
  console.log(`🚀 MCP server listening on http://localhost:${PORT}/mcp`);
  console.log(`📦 Tool mode: ${TOOL_MODE}`);
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