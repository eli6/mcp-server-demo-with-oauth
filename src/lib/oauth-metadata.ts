import { Express } from "express";

export interface OAuthConfig {
  OAUTH_SERVER_URL: string;
  SCOPES_SUPPORTED: string[];
}

export function registerOAuthEndpoints(app: Express, config: OAuthConfig) {
  // OAuth Protected Resource metadata endpoint (MUST be public - no auth required)
  // Note: The oauth-authorization-server endpoint is provided by the OAuth server itself
  // (e.g., Auth0 exposes it at https://your-tenant.auth0.com/.well-known/oauth-authorization-server)
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    res.json({
      resource: `${baseUrl}`, // Your MCP server is the protected resource
      authorization_servers: [config.OAUTH_SERVER_URL], // Where to get tokens
      scopes_supported: config.SCOPES_SUPPORTED,
      bearer_methods_supported: ["header"],
      introspection_endpoint: `${config.OAUTH_SERVER_URL}/introspect`
    });
  });
}

