import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function registerTools(mcp: McpServer) {
  // Register HTML UI resource
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
    <h3>Greet from a simple html component</h3>
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

  // UI-enabled greet tool
  mcp.registerTool(
    "greet",
    {
      title: "Greeting Tool",
      description: "Say hello",
      _meta: {
        "openai/outputTemplate": "ui://widget/greet.html",
        "openai/toolInvocation/invoking": "Saying hello…",
        "openai/toolInvocation/invoked": "Said hello",
        "openai/widgetAccessible": true
      },
      inputSchema: {
        name: z.string().describe('Name to greet'),
      },
    },
    async ({ name }): Promise<CallToolResult> => ({
      structuredContent: { name, greeting: `Hello, ${name}!` },
      content: [{ type: "text", text: `Hello, ${name}!` }]
    })
  );

  // Keep count tool as-is (no UI needed)
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
}

