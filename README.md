# Minimal MCP Server + OAuth Demo (Bare Setup Guide)

This guide shows a minimal, copy‑ready flow to run:
- A Streamable HTTP MCP server (with SSE) on port 3000
- A separate OAuth Authorization Server (demo) on port 3001 that you can later swap for a managed IdP. 

⚠️ Do not use this OAuth service in production, it is just for demonstration purposes.

**Architecture**: Two separate servers for realistic production setup. The MCP server focuses purely on MCP functionality while the OAuth server handles all authentication flows.

Use this as the README for a bare server repo.

## 1) Install and start

Install dependencies:

```bash
npm ci
```

Start the OAuth demo (port 3001):

```bash
npm run dev:oauth
```

Start the MCP server (port 3000) with token validation via introspection:

```bash
OAUTH_INTROSPECT_URL=http://localhost:3001/introspect npm run dev
```

**Note**: The MCP server automatically points to the OAuth server at `http://localhost:3001` for all OAuth metadata and token validation.

Tip: If you want to run MCP without auth locally, omit the env var:

```bash
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