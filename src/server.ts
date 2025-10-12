import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Config
const PORT = parseInt(process.env.PORT || "3000", 10);
const OAUTH_INTROSPECT_URL = process.env.OAUTH_INTROSPECT_URL; // e.g. https://auth.example.com/introspect
const REQUIRE_AUTH = !!OAUTH_INTROSPECT_URL;

// Simple Bearer auth using introspection (opaque tokens)
async function verifyAccessToken(token: string) {
  if (!REQUIRE_AUTH) return { clientId: "dev", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  const res = await fetch(OAUTH_INTROSPECT_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString()
  });
  if (!res.ok) throw new Error(`Introspection failed: ${res.status}`);
  const data = await res.json();
  if (!data.active) throw new Error("Token inactive");
  return {
    clientId: data.client_id ?? "unknown",
    scopes: (data.scope ? String(data.scope).split(" ") : []) as string[],
    expiresAt: typeof data.exp === "number" ? data.exp : Math.floor(Date.now() / 1000) + 3600
  };
}

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", exposedHeaders: ["Mcp-Session-Id"] }));

// Optional Bearer auth middleware
app.use(async (req, res, next) => {
  if (!REQUIRE_AUTH) return next();
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "missing_authorization" });
    const [type, token] = auth.split(" ");
    if (!token || type.toLowerCase() !== "bearer") return res.status(401).json({ error: "invalid_authorization" });
    const info = await verifyAccessToken(token);
    if (info.expiresAt < Math.floor(Date.now() / 1000)) return res.status(401).json({ error: "token_expired" });
    (req as any).auth = info;
    next();
  } catch (e: any) {
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

app.listen(PORT, () => {
  console.log(`MCP server listening on http://localhost:${PORT}/mcp`);
  if (REQUIRE_AUTH) console.log(`Using introspection at ${OAUTH_INTROSPECT_URL}`);
});