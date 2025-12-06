import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function registerTools(mcp: McpServer) {
  // Load React bundle
  let greetBundle = '';
  try {
    greetBundle = readFileSync(
      join(__dirname, '../../web/dist/greet.js'),
      'utf-8'
    );
  } catch (error) {
    console.warn('[ui-react] React bundle not found. Run "npm run build:web" first.');
    console.warn('[ui-react] Falling back to basic HTML.');
  }

  // Register React UI resource
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
  </head>
  <body>
    <div id="root"></div>
    <script type="importmap">
      {
        "imports": {
          "react": "https://esm.sh/react@18",
          "react-dom": "https://esm.sh/react-dom@18",
          "react-dom/client": "https://esm.sh/react-dom@18/client"
        }
      }
    </script>
    <script type="module">
      ${greetBundle || 'console.error("React bundle not loaded. Run npm run build:web");'}
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

