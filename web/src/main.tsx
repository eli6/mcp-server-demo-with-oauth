import React from 'react';
import { createRoot } from 'react-dom/client';
import { GreetWidget } from './components/greet';

// Type definitions for window.openai API
interface ToolOutput {
  name?: string;
  greeting?: string;
}

interface CallToolResponse {
  structuredContent?: {
    greeting?: string;
    [key: string]: unknown;
  };
  content?: Array<{
    type: string;
    text?: string;
    [key: string]: unknown;
  }>;
}

interface OpenAIGlobal {
  toolOutput?: ToolOutput | null;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<CallToolResponse>;
}

declare global {
  interface Window {
    openai?: OpenAIGlobal;
  }
}

// Mock window.openai for local testing
if (!window.openai) {
  window.openai = {
    toolOutput: {
      name: 'Test User',
      greeting: 'Welcome to dev mode!'
    },
    callTool: async (name: string, args: Record<string, unknown>) => {
      console.log('Mock callTool:', name, args);
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 500));
      return {
        structuredContent: {
          greeting: `Hello, ${args.name}! (Mock response)`
        }
      };
    }
  };
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const reactRoot = createRoot(rootElement);
reactRoot.render(
    <><h1>UI elements for this Chat GPT app</h1>
    <h2>Greet:</h2><GreetWidget />
</>);

