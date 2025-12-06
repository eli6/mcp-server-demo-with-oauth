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

async function verifyJwtToken(
  token: string,
  config: AuthConfig,
  expectedResource?: string
): Promise<AuthResult> {
  if (!config.JWT_JWKS_URL) {
    throw new Error("JWT_JWKS_URL or JWT_ISSUER required for JWT mode");
  }

  const JWKS = createRemoteJWKSet(new URL(config.JWT_JWKS_URL));
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    algorithms: ["RS256"]
  });

  const scopes = parseScopes(payload);
  
  if (typeof payload.exp !== "number") {
    throw new Error("Token missing required exp claim");
  }
  const expiresAt = payload.exp;

  if (expectedResource && payload.aud) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(expectedResource)) {
      console.warn(`[auth] audience mismatch: token.aud="${JSON.stringify(payload.aud)}" expected="${expectedResource}"`);
      throw new Error("Token not intended for this resource");
    }
  }

  return {
    clientId: (payload.client_id as string) || (payload.sub as string) || "unknown",
    scopes,
    expiresAt
  };
}

async function verifyTokenViaIntrospection(
  token: string,
  config: AuthConfig,
  expectedResource?: string
): Promise<AuthResult> {
  const response = await fetch(config.OAUTH_INTROSPECT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString()
  });

  if (!response.ok) {
    throw new Error(`Introspection failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.active) {
    throw new Error("Token inactive");
  }

  if (expectedResource && data.aud && data.aud !== expectedResource) {
    console.warn(`[auth] audience mismatch: token.aud="${data.aud}" expected="${expectedResource}"`);
    throw new Error("Token not intended for this resource");
  }

  return {
    clientId: data.client_id ?? "unknown",
    scopes: (data.scope ? String(data.scope).split(" ") : []) as string[],
    expiresAt: typeof data.exp === "number" 
      ? data.exp 
      : Math.floor(Date.now() / 1000) + 3600
  };
}

// Bearer auth supporting either introspection (opaque tokens) or JWT validation (JWKS)
export async function verifyAccessToken(
  token: string, 
  config: AuthConfig, 
  expectedResource?: string
): Promise<AuthResult> {
  if (config.DISABLE_AUTH) {
    return { 
      clientId: "dev", 
      scopes: [], 
      expiresAt: Math.floor(Date.now() / 1000) + 3600 
    };
  }

  if (config.AUTH_TOKEN_MODE === "jwt") {
    return await verifyJwtToken(token, config, expectedResource);
  }

  return await verifyTokenViaIntrospection(token, config, expectedResource);
}

export function parseScopes(payload: JWTPayload): string[] {
  const raw = (payload.scope as string) || (payload.scp as string) || undefined;
  if (!raw) return [];
  return String(raw).split(" ").filter(Boolean);
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }
  
  const [type, token] = authorizationHeader.split(" ");
  if (!token || type.toLowerCase() !== "bearer") {
    return null;
  }
  
  return token;
}

function isTokenExpired(authInfo: AuthResult): boolean {
  const currentTime = Math.floor(Date.now() / 1000);
  return authInfo.expiresAt < currentTime;
}

function sendUnauthorizedResponse(
  res: any,
  resourceMetadataUrl: string,
  error: string,
  message?: string
): void {
  res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}", scope="mcp:tools"`);
  const responseBody: any = { error };
  if (message) {
    responseBody.message = message;
  }
  res.status(401).json(responseBody);
}

export function createAuthMiddleware(config: AuthConfig) {
  return async (req: any, res: any, next: any) => {
    if (config.DISABLE_AUTH) return next();
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    // Prefer configured audience to avoid http/https host-derived mismatches
    const expectedResource = config.JWT_AUDIENCE || `${baseUrl}/mcp`;
    const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
    
    try {
      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        console.warn(`[auth] missing or invalid authorization for ${req.method} ${req.originalUrl}`);
        sendUnauthorizedResponse(res, resourceMetadataUrl, "missing_authorization");
        return;
      }

      const authInfo = await verifyAccessToken(token, config, expectedResource);
      
      if (isTokenExpired(authInfo)) {
        console.warn(`[auth] token expired for client ${authInfo.clientId}`);
        sendUnauthorizedResponse(res, resourceMetadataUrl, "token_expired");
        return;
      }

      req.auth = authInfo;
      next();
    } catch (error: any) {
      console.warn(`[auth] invalid_token on ${req.method} ${req.originalUrl}: ${error?.message || error}`);
      sendUnauthorizedResponse(res, resourceMetadataUrl, "invalid_token", String(error?.message ?? error));
    }
  };
}

