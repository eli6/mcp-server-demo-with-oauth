import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Config
const PORT = parseInt(process.env.PORT || "3000", 10);
const OAUTH_SERVER_URL = process.env.OAUTH_SERVER_URL || "http://localhost:3001";
const DISABLE_AUTH = String(process.env.DISABLE_AUTH || "").toLowerCase() === "true" || process.env.DISABLE_AUTH === "1";
const OAUTH_INTROSPECT_URL = process.env.OAUTH_INTROSPECT_URL || `${OAUTH_SERVER_URL}/introspect`;
const REQUIRE_AUTH = !DISABLE_AUTH;
const SCOPES_SUPPORTED = ["mcp:tools", "openid", "profile", "email"];

// Simple Bearer auth using introspection (opaque tokens)
async function verifyAccessToken(token: string, expectedResource?: string) {
  if (!REQUIRE_AUTH) return { clientId: "dev", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  
  // Use external introspection (OAuth server)
  const res = await fetch(OAUTH_INTROSPECT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString()
  });
  if (!res.ok) throw new Error(`Introspection failed: ${res.status}`);
  const data = await res.json();
  if (!data.active) throw new Error("Token inactive");
  
  // Validate audience/resource for external tokens
  if (expectedResource && data.aud && data.aud !== expectedResource) {
    throw new Error("Token not intended for this resource");
  }
  
  return {
    clientId: data.client_id ?? "unknown",
    scopes: (data.scope ? String(data.scope).split(" ") : []) as string[],
    expiresAt: typeof data.exp === "number" ? data.exp : Math.floor(Date.now() / 1000) + 3600
  };
}

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", exposedHeaders: ["Mcp-Session-Id"] }));

// OAuth metadata endpoints (MUST be public - no auth required)
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: OAUTH_SERVER_URL,
    authorization_endpoint: `${OAUTH_SERVER_URL}/authorize`,
    token_endpoint: `${OAUTH_SERVER_URL}/token`,
    registration_endpoint: `${OAUTH_SERVER_URL}/register`,
    introspection_endpoint: `${OAUTH_SERVER_URL}/introspect`,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"]
  });
});

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  res.json({
    resource: `${baseUrl}/mcp`, // Your MCP server is the protected resource
    authorization_servers: [OAUTH_SERVER_URL], // Where to get tokens
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ["header"],
    introspection_endpoint: `${OAUTH_SERVER_URL}/introspect`
  });
});


// Optional Bearer auth middleware (only for MCP endpoints)
app.use(async (req, res, next) => {
  if (!REQUIRE_AUTH) return next();
  
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const resource = `${baseUrl}/mcp`;
  const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
  
  try {
    const auth = req.headers.authorization;
    if (!auth) {
      res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}", scope="mcp:tools"`);
      return res.status(401).json({ error: "missing_authorization" });
    }
    const [type, token] = auth.split(" ");
    if (!token || type.toLowerCase() !== "bearer") {
      res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}", scope="mcp:tools"`);
      return res.status(401).json({ error: "invalid_authorization" });
    }
    const info = await verifyAccessToken(token, resource);
    if (info.expiresAt < Math.floor(Date.now() / 1000)) {
      res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}", scope="mcp:tools"`);
      return res.status(401).json({ error: "token_expired" });
    }
    (req as any).auth = info;
    next();
  } catch (e: any) {
    res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}", scope="mcp:tools"`);
    return res.status(401).json({ error: "invalid_token", message: String(e?.message ?? e) });
  }
});

// Build MCP server instance
function buildMcp() {
  const mcp = new McpServer({ 
    name: "minimal-mcp", 
    version: "0.1.0"
  }, { 
    capabilities: { logging: {} } 
  });

  // Simple greet tool
  mcp.registerTool(
    "greet",
    {
      title: "Greeting Tool",
      description: "Say hello",
      inputSchema: {
        name: z.string().describe('Name to greet'),
      },
    },
    async ({ name }): Promise<CallToolResult> => ({
      content: [{ type: "text", text: `Hello, ${name}!` }]
    })
  );


    mcp.tool(
      'count',
      'A tool that counts to a given number',
      {
        number: z.number().describe('Number to count to'),
      },
      {
        title: 'Counting Tool',
        readOnlyHint: true,
        openWorldHint: false
      },
      async ({ number }, extra): Promise<CallToolResult> => {
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        let currentCount = 0;

        while (currentCount < number) {
          currentCount++;
          await mcp.sendLoggingMessage({
            level: "info",
            data: `Counted to ${currentCount}`
          }, extra.sessionId);
          await sleep(1000);
        }
  
        return {
          content: [
            {
              type: 'text',
              text: `Counting to ${number}`,
            }
          ],
        };
      }
    );

  return mcp;
}

// Session map
const transports: Record<string, StreamableHTTPServerTransport> = {};

// POST /mcp (JSON-RPC)
app.post("/mcp", async (req: Request, res: Response) => {
  // Clients must accept both (per Streamable HTTP)
  const accept = String(req.headers["accept"] || "");
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
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
      <head><title>MCP Server</title></head>
      <body>
        <h1>MCP Server</h1>
        <p>This is the MCP server with OAuth integration.</p>
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
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 MCP server listening on http://localhost:${PORT}/mcp`);
  console.log(`📋 OAuth metadata at: http://localhost:${PORT}/.well-known/oauth-authorization-server`);
  console.log(`🔒 Protected resource metadata at: http://localhost:${PORT}/.well-known/oauth-protected-resource`);
  console.log(`ℹ️  Info page at: http://localhost:${PORT}/`);
  console.log(`🔐 OAuth server: ${OAUTH_SERVER_URL}`);
  if (REQUIRE_AUTH) {
    console.log(`✅ Using OAuth introspection at ${OAUTH_INTROSPECT_URL}`);
  } else {
    console.log(`⚠️  OAuth disabled - no authentication required`);
  }
});