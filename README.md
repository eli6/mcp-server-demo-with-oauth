# Minimal MCP Server + OAuth Demo (Bare Setup Guide)

This guide shows a minimal, copy‑ready flow to run:
- A Streamable HTTP MCP server (with SSE) on port 3000
- A separate OAuth Authorization Server (demo) on port 3001 that you can later swap for a managed IdP. 

⚠️ Do not use this OAuth service in production, it is just for demonstration purposes.

**Architecture**: Two separate servers for realistic production setup. The MCP server focuses purely on MCP functionality while the OAuth server handles all authentication flows.

Use this as the README for a bare server repo.

## 0) Docker quickstart (no auth)

```bash
npm run docker:build
npm run docker:run
```

## 1) Install and start

Install dependencies:

```bash
npm ci
```

Start the OAuth demo (port 3001):

```bash
npm run dev:oauth
```

## Tool Modes & Development

This server supports three distinct tool modes, each optimized for different use cases. Choose the mode that best fits your needs:

### 🛠️ Basic Tools Mode (Default)

**Best for:** Learning MCP fundamentals, CLI tools, and simple text-based interactions.

The basic mode provides core MCP functionality with simple text-based tool responses. Perfect for understanding the MCP protocol without UI complexity.

```bash
npm run dev
```

**Features:**
- Pure MCP protocol implementation
- Text-based tool responses
- Minimal dependencies
- Fast and lightweight

### 🎨 HTML UI Mode

**Best for:** Quick prototypes, simple forms, and lightweight interactive components.

HTML UI mode enables rich, interactive components using vanilla HTML, CSS, and JavaScript. Components are served as standalone HTML files that can be embedded in MCP clients.

```bash
npm run dev:ui-html
```

**Features:**
- Interactive HTML components
- No build step required
- Fast iteration
- Lightweight bundle size

### ⚛️ React UI Mode

**Best for:** Complex, stateful components and modern React-based UIs.

React UI mode provides full React component support with TypeScript, enabling sophisticated user interfaces with state management, hooks, and modern React patterns.

```bash
npm run dev:ui-react
```

**Features:**
- Full React 18+ support
- TypeScript for type safety
- Component state management
- Modern React patterns (hooks, context, etc.)

### 🧪 React Component Development

The `web/` directory contains a lightweight React development environment for designing and testing your UI components locally.

**Start the development server:**
```bash
cd web
npm run dev
```

This launches a Vite-powered dev server with:
- ⚡ Hot module replacement (instant updates)
- 🔍 Component preview in browser
- 🎯 Mock `window.openai` API for testing
- 📦 Automatic TypeScript compilation

Edit `web/src/components/greet.tsx` and see your changes instantly. The mock API simulates tool calls, so you can develop and test your component's behavior without running the full MCP server.

**Build for production:**
```bash
cd web
npm run build
```

This generates `web/dist/greet.js`, which is automatically included when running the MCP server in React UI mode.

### 🐳 Docker Configuration

In production deployments, configure the tool mode by changing the `CMD` in your Dockerfile to use the appropriate npm script. The npm scripts already set the `TOOL_MODE` environment variable internally, so you don't need to set it separately.

**Dockerfile:**
```dockerfile
# Choose the start script that matches your desired mode:
# CMD ["npm", "run", "start"]           # Basic tools (default)
# CMD ["npm", "run", "start:ui-html"]   # HTML UI
CMD ["npm", "run", "start:ui-react"]    # React UI
```

**Examples for different modes:**
```dockerfile
# Basic mode (no UI)
CMD ["npm", "run", "start"]

# HTML UI mode  
CMD ["npm", "run", "start:ui-html"]

# React UI mode
CMD ["npm", "run", "start:ui-react"]
```

The Dockerfile automatically builds React components during the image build process, so React UI mode is ready to use in production.

---

### Development Tips

**Run without authentication (local testing):**
```bash
DISABLE_AUTH=true npm run dev
```

**Switch between modes:**
- `npm run dev` → Basic tools
- `npm run dev:ui-html` → HTML UI
- `npm run dev:ui-react` → React UI (builds web components first)

### Token modes: introspection (local default) or JWT (managed IdP)

This server supports two auth modes, controlled by `AUTH_TOKEN_MODE`:

- `introspection` (default): Validate opaque tokens via `OAUTH_INTROSPECT_URL` (RFC 7662).
- `jwt`: Validate JWT access tokens using JWKS.

Local default uses opaque tokens (no JWT config required). For a managed IdP that issues JWT access tokens, switch to JWT mode and set these:

```
DISABLE_AUTH=false
AUTH_TOKEN_MODE=jwt
JWT_ISSUER=https://your-tenant.example.com/
JWT_AUDIENCE=https://api.example.com   # optional depending on IdP
# JWT_JWKS_URL defaults to ${JWT_ISSUER}/.well-known/jwks.json
```

Example run with a managed IdP (JWT mode):

```bash
# .env
DISABLE_AUTH=false
AUTH_TOKEN_MODE=jwt
JWT_ISSUER=https://your-tenant.example.com/
# Optional, depends on IdP
JWT_AUDIENCE=https://api.example.com
# Optional override if issuer does not expose well-known JWKS
# JWT_JWKS_URL=https://your-tenant.example.com/.well-known/jwks.json
OAUTH_SERVER_URL=https://your-tentant-url.com

npm run dev
```

## 2) Generate PKCE (verifier + S256 challenge)

```bash
node -e "const c=require('crypto');const v=c.randomBytes(48).toString('base64url');const ch=c.createHash('sha256').update(v).digest('base64url');console.log({code_verifier:v,code_challenge:ch})"
```

Save both `code_verifier` and `code_challenge` for the next steps.

## 3) Register a client

```bash
curl -sS -X POST http://localhost:3001/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name":"cli",
    "redirect_uris":["https://oauth.pstmn.io/v1/callback"],
    "grant_types":["authorization_code"],
    "response_types":["code"],
    "token_endpoint_auth_method":"client_secret_post",
    "scope":"mcp:tools"
  }'
```

Save `client_id` and `client_secret` from the response.

## 4) Authorize (don’t auto-follow redirects)

```bash
curl -sS -o /dev/null -D - -G http://localhost:3001/authorize \
  --data-urlencode "client_id=YOUR_CLIENT_ID" \
  --data-urlencode "redirect_uri=https://oauth.pstmn.io/v1/callback" \
  --data-urlencode "response_type=code" \
  --data-urlencode "scope=mcp:tools" \
  --data-urlencode "state=xyz" \
  --data-urlencode "code_challenge=YOUR_CODE_CHALLENGE" \
  --data-urlencode "code_challenge_method=S256" \
  --data-urlencode "resource=http://localhost:3000/mcp"
```

Copy the `code` from the `Location:` header (or open the redirect URL and copy the `code` query param).

## 5) Exchange code for tokens

```bash
curl -sS -X POST http://localhost:3001/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=THE_CODE" \
  --data-urlencode "code_verifier=YOUR_CODE_VERIFIER" \
  --data-urlencode "redirect_uri=https://oauth.pstmn.io/v1/callback" \
  --data-urlencode "client_id=YOUR_CLIENT_ID" \
  --data-urlencode "client_secret=YOUR_CLIENT_SECRET" \
  --data-urlencode "resource=http://localhost:3000/mcp"
```

Save `access_token` from the response.

## 6) Initialize MCP (first POST; no session header yet)

```bash
curl -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-03-26",
      "capabilities":{},
      "clientInfo":{"name":"cli","version":"1.0.0"}
    }
  }'
```

Copy `Mcp-Session-Id` from the response headers.

## 7) Open SSE (in another terminal)

```bash
curl -i -N http://localhost:3000/mcp \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Mcp-Session-Id: SESSION_ID"
```

Leave this running to receive notifications.

## 8) List tools and call one

List tools:

```bash
curl -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Mcp-Session-Id: SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Call `greet`:

```bash
curl -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Mcp-Session-Id: SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"greet","arguments":{"name":"Elin"}}}'
```

**Tool mode differences:**
- **Basic mode:** Returns simple text response: `"Hello, Elin!"`
- **HTML UI mode:** Returns HTML component template (`ui://widget/greet.html`) with structured content for hydration
- **React UI mode:** Returns React component template (`ui://widget/greet.js`) with full React support and state management

In UI modes, rich clients can render interactive components that allow users to interact directly with the tool, and components can initiate tool calls via the `window.openai.callTool` API when supported.

Call `count`:

```bash
curl -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Mcp-Session-Id: SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"count","arguments":{"number":5}}}'
```


## Notes / Troubleshooting

- POST `/mcp` must include `Accept: application/json, text/event-stream` (not `*/*`).
- First POST must be `initialize` with no `Mcp-Session-Id`. All subsequent requests must include the returned `Mcp-Session-Id` header.
- If you started MCP with token validation, every request to `/mcp` must include `Authorization: Bearer ACCESS_TOKEN`.
- Tokens in the demo AS are short‑lived. If calls start failing, redo steps 2–5 and re‑initialize.
- Quick token check:

```bash
curl -sS -X POST http://localhost:3001/introspect \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "token=ACCESS_TOKEN"
```

- SSE hosting: ensure your platform supports long‑lived responses and doesn’t buffer SSE.
- Redirects: if you use `https://oauth.pstmn.io/v1/callback`, it only captures the code for you; your tokens are still issued by your OAuth server.

## Swapping to a managed IdP later

**Easy Migration**: Since the servers are separated, you can easily swap the OAuth server for a managed provider:

1. **Replace the demo OAuth server** with a real provider (Auth0/Okta/Keycloak/ORY/Azure/Cognito)
2. **Update the MCP server configuration** - just change the `OAUTH_SERVER_URL` environment variable:
   ```bash
   OAUTH_SERVER_URL=https://yourcompany.okta.com npm run dev
   ```
3. **Keep the MCP contract the same** - validate tokens via JWT (JWKS) or introspection
4. **Client registration**: If your IdP supports Dynamic Client Registration, expose `/register`; otherwise, create clients via the IdP's admin API/UI

**Production Architecture**:
```
┌─────────────────┐    ┌─────────────────┐
│   MCP Server    │    │  Managed IdP    │
│   Your Domain   │◄──►│  (Okta/etc.)    │
│                 │    │                 │
│ • MCP endpoints │    │ • OAuth flows   │
│ • OAuth metadata│    │ • Token mgmt    │
│ • Bearer auth   │    │ • User mgmt     │
└─────────────────┘    └─────────────────┘
```