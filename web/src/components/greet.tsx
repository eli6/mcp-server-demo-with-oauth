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

type WidgetState = {
  name?: string;
};

interface OpenAIGlobal {
  toolOutput?: ToolOutput | null;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<CallToolResponse>;
  widgetState?: WidgetState | null;
  setWidgetState?: (state: WidgetState) => Promise<void>;
}

declare global {
  interface Window {
    openai?: OpenAIGlobal;
  }
}

function useWidgetState(defaultState: WidgetState): readonly [WidgetState, (nextState: WidgetState) => void] {
  const [widgetState, setWidgetStateLocal] = useState<WidgetState>(() => {
    const existingWidgetState = (window.openai?.widgetState as WidgetState | null) ?? null;
    if (existingWidgetState) {
      return existingWidgetState;
    }

    const initialToolOutput = (window.openai?.toolOutput as ToolOutput | undefined) || undefined;
    if (initialToolOutput?.name) {
      return { name: initialToolOutput.name };
    }

    return defaultState;
  });

  const persistAndSetWidgetState = (nextState: WidgetState) => {
    setWidgetStateLocal(nextState);
    if (window.openai?.setWidgetState) {
      window.openai.setWidgetState(nextState);
    }
  };

  return [widgetState, persistAndSetWidgetState] as const;
}

export function GreetWidget() {
  const [widgetState, setWidgetState] = useWidgetState({ name: '' });
  const [greeting, setGreeting] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Hydrate from initial tool output and listen for updates
  useEffect(() => {
    const updateFromToolOutput = () => {
      const toolOutput = (window.openai?.toolOutput as ToolOutput) || {};
      if (toolOutput.greeting) {
        setGreeting(toolOutput.greeting);
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
    const trimmedName = (widgetState.name || '').trim();
    if (!trimmedName) {
      setGreeting('Pop your name in first so we know who to celebrate.');
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
      } catch (error: any) {
        setGreeting(`Error: ${error?.message || error}`);
      } finally {
        setIsLoading(false);
      }
    } else {
      // Fallback if component-initiated calls are unavailable
      setGreeting(`Hello, ${trimmedName}!`);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleGreet();
    }
  };

  return (
    <div className="font-sans bg-pink-50 p-6 dark:bg-pink-950">
      <div className="mx-auto max-w-xl rounded-3xl border border-pink-300 bg-pink-50 p-6 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl dark:border-pink-500/60 dark:bg-pink-900 dark:shadow-[0_18px_50px_rgba(0,0,0,0.7)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full bg-pink-50 px-3 py-1 text-xs font-medium text-pink-700 ring-1 ring-inset ring-pink-200 dark:bg-pink-500/15 dark:text-pink-100 dark:ring-pink-400/40">
              <span className="h-1.5 w-1.5 rounded-full bg-pink-400 shadow-[0_0_0_4px_rgba(244,114,182,0.45)] dark:bg-pink-300 dark:shadow-[0_0_0_4px_rgba(244,114,182,0.35)]" />
              <span>Greet Tool</span>
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-pink-900 dark:text-pink-50">
              Simply say hi!
            </h3>
            <p className="text-sm text-pink-700/80 dark:text-pink-100/80">
              Type your name, hit greet, and let this widget do the confident intro for you.
            </p>
          </div>
          <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-pink-400 text-2xl font-semibold text-slate-950 shadow-lg shadow-pink-400/60 sm:flex">
            ✨
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs font-medium uppercase tracking-[0.2em] text-pink-800/80 dark:text-pink-100/80">
            Your name
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="text"
              placeholder="e.g. Emma"
              value={widgetState.name ?? ''}
              onChange={(event) => setWidgetState({ ...widgetState, name: event.target.value })}
              onKeyDown={handleKeyDown}
              className="flex-1 rounded-2xl border border-pink-200 bg-white px-3.5 py-2.5 text-sm text-pink-900 placeholder-pink-400 shadow-[0_1px_2px_rgba(15,23,42,0.08)] outline-none ring-0 transition focus:border-pink-400 focus:ring-2 focus:ring-pink-300/60 dark:border-pink-500/35 dark:bg-pink-950 dark:text-pink-50 dark:placeholder-pink-100/45 dark:shadow-inner dark:shadow-black/40 dark:focus:border-pink-300 dark:focus:ring-pink-400/60"
            />
            <button
              onClick={handleGreet}
              disabled={isLoading}
              className="inline-flex items-center justify-center rounded-2xl bg-pink-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-pink-400/60 transition hover:-translate-y-0.5 hover:bg-pink-500 hover:shadow-pink-300/80 disabled:cursor-default disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {isLoading ? 'Mixing your greet…' : 'Greet in style'}
            </button>
          </div>
        </div>

        {greeting && (
          <div className="mt-6 rounded-2xl border border-pink-300/60 bg-white/90 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.15)] dark:border-pink-400/25 dark:bg-pink-950/40 dark:shadow-inner dark:shadow-black/40">
            <div className="mb-1 text-xs font-medium uppercase tracking-[0.2em] text-pink-800/80 dark:text-pink-100/80">
              Preview
            </div>
            <div className="text-base font-medium leading-relaxed text-pink-900 dark:text-pink-50">
              {greeting}
            </div>
            <p className="mt-2 text-[11px] text-pink-500/80 dark:text-pink-100/70">
              Powered by your greet mcp server under the hood.
            </p>
          </div>
        )}

        {!greeting && (
          <div className="mt-4 text-[11px] text-pink-600/80 dark:text-pink-100/70">
            Tip: this component calls the{' '}
            <span className="font-semibold text-pink-700 dark:text-pink-200">greet tool</span> behind the scenes,
            so you can demo tools and UI together.
          </div>
        )}
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

