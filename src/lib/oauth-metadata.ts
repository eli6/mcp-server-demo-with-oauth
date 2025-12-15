import { Express, Request } from "express";

export interface OAuthConfig {
  OAUTH_SERVER_URL: string;
  SCOPES_SUPPORTED: string[];
}

function buildBaseUrl(request: Request): string {
  const protocolFromRequest = request.protocol;
  const hostFromRequest = request.get("host") ?? "";
  return `${protocolFromRequest}://${hostFromRequest}`;
}

function buildMcpEndpointUrl(request: Request): string {
  const baseUrl = buildBaseUrl(request);
  return `${baseUrl}/mcp`;
}

export function registerOAuthEndpoints(app: Express, config: OAuthConfig) {
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    const mcpEndpointUrl = buildMcpEndpointUrl(req);

    res.json({
      resource: mcpEndpointUrl,
      authorization_servers: [config.OAUTH_SERVER_URL],
      scopes_supported: config.SCOPES_SUPPORTED,
      bearer_methods_supported: ["header"],
      introspection_endpoint: `${config.OAUTH_SERVER_URL}/introspect`
    });
  });
}