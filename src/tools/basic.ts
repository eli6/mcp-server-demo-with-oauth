import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function registerBasicTools(mcp: McpServer) {
  // Simple greet tool (no UI)
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

  // Count tool
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

