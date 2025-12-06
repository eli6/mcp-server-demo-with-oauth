import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// Type definitions for window.openai API (ChatGPT UI components)
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

export function GreetWidget() {
  const [name, setName] = useState('');
  const [greeting, setGreeting] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Hydrate from initial tool output and listen for updates
  useEffect(() => {
    const updateFromToolOutput = () => {
      const toolOutput = (window.openai?.toolOutput as ToolOutput) || {};
      if (toolOutput.greeting) {
        setGreeting(toolOutput.greeting);
      }
      if (toolOutput.name) {
        setName(toolOutput.name);
      }
    };

    // Initial load
    updateFromToolOutput();

    // Listen for updates from the host
    const handleSetGlobals = (event: Event) => {
      const customEvent = event as CustomEvent<{ globals?: Partial<{ toolOutput?: ToolOutput }> }>;
      if (customEvent.detail?.globals?.toolOutput !== undefined) {
        updateFromToolOutput();
      }
    };

    window.addEventListener('openai:set_globals', handleSetGlobals);
    return () => {
      window.removeEventListener('openai:set_globals', handleSetGlobals);
    };
  }, []);

  const handleGreet = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setGreeting('Please enter a name.');
      return;
    }

    if (window.openai?.callTool) {
      setIsLoading(true);
      try {
        const res = await window.openai.callTool('greet', { name: trimmedName });
        // Prefer structuredContent first; fall back to content text
        if (res?.structuredContent?.greeting) {
          setGreeting(res.structuredContent.greeting);
        } else if (Array.isArray(res?.content) && res.content[0]?.text) {
          setGreeting(res.content[0].text);
        } else {
          setGreeting(`Hello, ${trimmedName}!`);
        }
      } catch (e: any) {
        setGreeting(`Error: ${e?.message || e}`);
      } finally {
        setIsLoading(false);
      }
    } else {
      // Fallback if component-initiated calls are unavailable
      setGreeting(`Hello, ${trimmedName}!`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleGreet();
    }
  };

  return (
    <div style={{
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      padding: '16px'
    }}>
      <div style={{
        borderRadius: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
        padding: '16px'
      }}>
        <div style={{ marginBottom: '12px' }}>
          <h3>Greet from a react component</h3>
        </div>
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}>
          <input
            type="text"
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              padding: '8px 10px',
              border: '1px solid #d1d5db',
              borderRadius: '8px'
            }}
          />
          <button
            onClick={handleGreet}
            disabled={isLoading}
            style={{
              padding: '8px 12px',
              border: 'none',
              background: '#111827',
              color: 'white',
              borderRadius: '8px',
              cursor: isLoading ? 'default' : 'pointer',
              opacity: isLoading ? 0.6 : 1
            }}
          >
            Greet
          </button>
        </div>
        {greeting && (
          <div style={{
            marginTop: '12px',
            color: '#111827',
            fontWeight: 500
          }}>
            {greeting}
          </div>
        )}
        <div style={{
          color: '#6b7280',
          fontSize: '12px',
          marginTop: '8px'
        }}>
          Tip: This component can call the greet tool directly when supported.
        </div>
      </div>
    </div>
  );
}

// Wait for window.openai to be available before mounting
function waitForOpenAI() {
  if (window.openai) {
    mountComponent();
  } else {
    // Listen for the openai:set_globals event
    window.addEventListener('openai:set_globals', mountComponent, { once: true });
    // Fallback: check periodically (in case event doesn't fire)
    const checkInterval = setInterval(() => {
      if (window.openai) {
        clearInterval(checkInterval);
        mountComponent();
      }
    }, 50);
    // Cleanup after 5 seconds if still not available
    setTimeout(() => clearInterval(checkInterval), 5000);
  }
}

function mountComponent() {
  const root = document.getElementById('root');
  if (root) {
    const reactRoot = createRoot(root);
    reactRoot.render(<GreetWidget />);
  }
}

waitForOpenAI();

