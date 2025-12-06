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

## Development modes

**Pure MCP (default):**
```bash
# .env (local opaque token default)
# OAUTH_SERVER_URL defaults to http://localhost:3001
# OAUTH_INTROSPECT_URL defaults to ${OAUTH_SERVER_URL}/introspect

DISABLE_AUTH=false
AUTH_TOKEN_MODE=introspection

npm run dev
```

**MCP + UI Components:**
```bash
# Same .env as above
npm run dev:ui
```

The pure MCP mode focuses on core MCP functionality (auth, tools, endpoints). The UI mode adds rich component experiences with interactive forms and visual feedback.

Tip: If you want to run MCP without auth locally, set the explicit flag (in env or inline):

```bash
DISABLE_AUTH=true npm run dev
```

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

**UI Mode:** The `greet` tool renders a simple component with an input field. In rich-UI clients, it is associated with the template `ui://widget/greet.html` and can initiate tool calls from the iframe when supported. The tool also returns `structuredContent` with `{ name, greeting }` so the component can hydrate initial UI state.

**Pure MCP Mode:** The `greet` tool returns simple text responses without UI components, perfect for learning MCP fundamentals.

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