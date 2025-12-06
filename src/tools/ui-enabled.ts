import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function registerUIEnabledTools(mcp: McpServer) {
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

