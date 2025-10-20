import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID, createHash, randomBytes } from "node:crypto";

// Config
const AUTH_PORT = parseInt(process.env.AUTH_PORT || "3001", 10);
const ISSUER = new URL(process.env.ISSUER_URL || `http://localhost:${AUTH_PORT}`);
const SCOPES_SUPPORTED = [
  "mcp:tools",
  "openid",
  "profile",
  "email",
];

// In-memory stores
type Client = {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  scope?: string;
  token_endpoint_auth_method?: "client_secret_post" | "none";
};
const clients = new Map<string, Client>();

type CodeRecord = {
  client_id: string;
  code_challenge: string;
  redirect_uri: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
};
const codes = new Map<string, CodeRecord>();

type TokenRecord = {
  token: string;
  client_id: string;
  scopes: string[];
  resource?: string;
  exp: number;
};
const tokens = new Map<string, TokenRecord>();

function b64url(input: Buffer) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function pkceChallengeFromVerifier(verifier: string) {
  return b64url(createHash("sha256").update(verifier).digest());
}

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Metadata
app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json({
    issuer: ISSUER.href,
    authorization_endpoint: new URL("/authorize", ISSUER).href,
    token_endpoint: new URL("/token", ISSUER).href,
    registration_endpoint: new URL("/register", ISSUER).href,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    scopes_supported: SCOPES_SUPPORTED
  });
});

// Dynamic Client Registration (demo)
app.post("/register", (req, res) => {
  const {
    client_name,
    redirect_uris,
    token_endpoint_auth_method = "none",
    scope = SCOPES_SUPPORTED.join(" ")
  } = req.body ?? {};

  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris required" });
  }

  const client_id = randomUUID();
  const client_secret = token_endpoint_auth_method === "none" ? undefined : randomBytes(32).toString("hex");
  const client: Client = { client_id, client_secret, redirect_uris, scope, token_endpoint_auth_method };
  clients.set(client_id, client);

  res.status(201).json({
    client_id,
    client_secret,
    client_name,
    redirect_uris,
    scope,
    token_endpoint_auth_method,
    client_id_issued_at: Math.floor(Date.now() / 1000)
  });
});

// Authorization (GET/POST)
app.all("/authorize", (req: Request, res: Response) => {
  const q = req.method === "POST" ? req.body : req.query;
  const client_id = String(q.client_id ?? "");
  const response_type = String(q.response_type ?? "");
  const redirect_uri = String(q.redirect_uri ?? "");
  const scope = String(q.scope ?? "");
  const state = q.state ? String(q.state) : undefined;
  const code_challenge = String(q.code_challenge ?? "");
  const ccm = String(q.code_challenge_method ?? "");
  const resource = q.resource ? String(q.resource) : undefined;

  // Validate client
  const client = clients.get(client_id);
  if (!client) return res.status(400).json({ error: "invalid_client" });
  if (!redirect_uri || !client.redirect_uris.includes(redirect_uri)) {
    return res.status(400).json({ error: "invalid_request", error_description: "redirect_uri mismatch" });
  }
  if (response_type !== "code") {
    return res.redirect(buildErrorRedirect(redirect_uri, "unsupported_response_type", "Only code supported", state));
  }
  if (ccm !== "S256" || !code_challenge) {
    return res.redirect(buildErrorRedirect(redirect_uri, "invalid_request", "PKCE S256 required", state));
  }
  // Scope check (if provided)
  const requested = scope ? scope.split(" ") : [];
  const allowed = new Set((client.scope ?? "").split(" ").filter(Boolean));
  for (const s of requested) {
    if (!allowed.has(s)) {
      return res.redirect(buildErrorRedirect(redirect_uri, "invalid_scope", `scope ${s} not allowed`, state));
    }
  }

  const code = randomUUID();
  codes.set(code, {
    client_id,
    code_challenge,
    redirect_uri,
    scopes: requested,
    resource,
    expiresAt: Date.now() + 5 * 60_000 // 5 min
  });

  const sp = new URLSearchParams({ code });
  if (state) sp.set("state", state);
  res.redirect(`${redirect_uri}?${sp.toString()}`);
});

function buildErrorRedirect(redirect_uri: string, error: string, desc: string, state?: string) {
  const u = new URL(redirect_uri);
  u.searchParams.set("error", error);
  u.searchParams.set("error_description", desc);
  if (state) u.searchParams.set("state", state);
  return u.toString();
}

// Token (authorization_code + PKCE)
app.post("/token", (req: Request, res: Response) => {
  const { grant_type } = req.body ?? {};
  if (grant_type !== "authorization_code") {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }

  const client_id = String(req.body.client_id ?? "");
  const client_secret = req.body.client_secret ? String(req.body.client_secret) : undefined;
  const code = String(req.body.code ?? "");
  const code_verifier = String(req.body.code_verifier ?? "");
  const redirect_uri = req.body.redirect_uri ? String(req.body.redirect_uri) : undefined;
  const resource = req.body.resource ? String(req.body.resource) : undefined;

  const client = clients.get(client_id);
  if (!client) return res.status(400).json({ error: "invalid_client" });
  if (client.client_secret) {
    if (!client_secret || client_secret !== client.client_secret) {
      return res.status(401).json({ error: "invalid_client" });
    }
  }

  const rec = codes.get(code);
  if (!rec) return res.status(400).json({ error: "invalid_grant", error_description: "invalid code" });
  if (rec.expiresAt < Date.now()) {
    codes.delete(code);
    return res.status(400).json({ error: "invalid_grant", error_description: "code expired" });
  }
  if (rec.client_id !== client_id) return res.status(400).json({ error: "invalid_grant" });
  if (redirect_uri && redirect_uri !== rec.redirect_uri) return res.status(400).json({ error: "invalid_grant" });
  if (resource && rec.resource && resource !== rec.resource) return res.status(400).json({ error: "invalid_target" });

  // PKCE verify
  if (!code_verifier || pkceChallengeFromVerifier(code_verifier) !== rec.code_challenge) {
    return res.status(400).json({ error: "invalid_grant", error_description: "code_verifier mismatch" });
  }

  codes.delete(code);

  const access_token = randomUUID();
  const exp = Math.floor(Date.now() / 1000) + 3600; // 1h
  tokens.set(access_token, {
    token: access_token,
    client_id,
    scopes: rec.scopes,
    resource: rec.resource,
    exp
  });

  res.json({
    access_token,
    token_type: "bearer",
    expires_in: 3600,
    scope: rec.scopes.join(" ")
  });
});

// Introspection (opaque tokens)
app.post("/introspect", (req: Request, res: Response) => {
  const token = String(req.body?.token ?? "");
  const rec = tokens.get(token);
  if (!rec) return res.status(200).json({ active: false });
  const now = Math.floor(Date.now() / 1000);
  if (rec.exp <= now) return res.status(200).json({ active: false });
  res.json({
    active: true,
    client_id: rec.client_id,
    scope: rec.scopes.join(" "),
    exp: rec.exp,
    aud: rec.resource
  });
});

app.listen(AUTH_PORT, () => {
  console.log(`OAuth demo listening on http://localhost:${AUTH_PORT}`);
  console.log(`Issuer: ${ISSUER.href}`);
});