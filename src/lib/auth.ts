import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

export interface AuthConfig {
  DISABLE_AUTH: boolean;
  AUTH_TOKEN_MODE: "introspection" | "jwt";
  OAUTH_INTROSPECT_URL: string;
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
  JWT_JWKS_URL?: string;
}

export interface AuthResult {
  clientId: string;
  scopes: string[];
  expiresAt: number;
}

// Bearer auth supporting either introspection (opaque tokens) or JWT validation (JWKS)
export async function verifyAccessToken(token: string, config: AuthConfig, expectedResource?: string): Promise<AuthResult> {
  if (!config.DISABLE_AUTH) return { clientId: "dev", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600 };

  if (config.AUTH_TOKEN_MODE === "jwt") {
    if (!config.JWT_JWKS_URL) throw new Error("JWT_JWKS_URL or JWT_ISSUER required for JWT mode");
    const JWKS = createRemoteJWKSet(new URL(config.JWT_JWKS_URL));
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      algorithms: ["RS256"]
    });

    const scopes = parseScopes(payload);
    const exp = typeof payload.exp === "number" ? payload.exp : Math.floor(Date.now() / 1000) + 3600;
    if (expectedResource && payload.aud && typeof payload.aud === "string" && payload.aud !== expectedResource) {
      console.warn(`[auth] audience mismatch: token.aud="${payload.aud}" expected="${expectedResource}"`);
      throw new Error("Token not intended for this resource");
    }
    return {
      clientId: (payload.client_id as string) || (payload.sub as string) || "unknown",
      scopes,
      expiresAt: exp,
    };
  } else {
    // Use external introspection (opaque tokens)
    const res = await fetch(config.OAUTH_INTROSPECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString()
    });
    if (!res.ok) throw new Error(`Introspection failed: ${res.status}`);
    const data = await res.json();
    if (!data.active) throw new Error("Token inactive");

    if (expectedResource && data.aud && data.aud !== expectedResource) {
      console.warn(`[auth] audience mismatch: token.aud="${data.aud}" expected="${expectedResource}"`);
      throw new Error("Token not intended for this resource");
    }
    return {
      clientId: data.client_id ?? "unknown",
      scopes: (data.scope ? String(data.scope).split(" ") : []) as string[],
      expiresAt: typeof data.exp === "number" ? data.exp : Math.floor(Date.now() / 1000) + 3600
    };
  }
}

export function parseScopes(payload: JWTPayload): string[] {
  const raw = (payload.scope as string) || (payload.scp as string) || undefined;
  if (!raw) return [];
  return String(raw).split(" ").filter(Boolean);
}

export function createAuthMiddleware(config: AuthConfig) {
  return async (req: any, res: any, next: any) => {
    if (config.DISABLE_AUTH) return next();
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    // Prefer configured audience to avoid http/https host-derived mismatches
    const expectedResource = config.JWT_AUDIENCE || `${baseUrl}/mcp`;
    const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
    
    try {
      const auth = req.headers.authorization;
      if (!auth) {
        console.warn(`[auth] missing authorization for ${req.method} ${req.originalUrl}`);
        res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}", scope="mcp:tools"`);
        return res.status(401).json({ error: "missing_authorization" });
      }
      const [type, token] = auth.split(" ");
      if (!token || type.toLowerCase() !== "bearer") {
        console.warn(`[auth] invalid authorization header for ${req.method} ${req.originalUrl}: ${auth}`);
        res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}", scope="mcp:tools"`);
        return res.status(401).json({ error: "invalid_authorization" });
      }
      const info = await verifyAccessToken(token, config, expectedResource);
      if (info.expiresAt < Math.floor(Date.now() / 1000)) {
        console.warn(`[auth] token expired for client ${info.clientId}`);
        res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}", scope="mcp:tools"`);
        return res.status(401).json({ error: "token_expired" });
      }
      req.auth = info;
      next();
    } catch (e: any) {
      console.warn(`[auth] invalid_token on ${req.method} ${req.originalUrl}: ${e?.message || e}`);
      res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}", scope="mcp:tools"`);
      return res.status(401).json({ error: "invalid_token", message: String(e?.message ?? e) });
    }
  };
}

