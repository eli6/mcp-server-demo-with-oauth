# syntax=docker/dockerfile:1

FROM node:20-alpine
WORKDIR /app

# Install root dependencies with caching
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Build web components if web/ directory exists (for React UI mode)
# Copy entire web directory (package.json, src/, tsconfig.json)
COPY web/ ./web/
RUN if [ -f web/package.json ]; then \
      cd web && npm ci && npm run build; \
    fi

# Copy source
COPY tsconfig.json ./
COPY src ./src

# App listens on 3000
EXPOSE 3000

# Tool mode: basic (default), ui-html, or ui-react
# Start the MCP server (uses devDependency tsx)
CMD ["npm", "run", "start:ui-react"]
