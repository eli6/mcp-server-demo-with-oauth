# syntax=docker/dockerfile:1

FROM node:20-alpine
WORKDIR /app

# Install dependencies with caching
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source
COPY tsconfig.json ./
COPY src ./src

# App listens on 3000
EXPOSE 3000

# Explicitly disable auth by default in this image (can override at runtime)
#ENV DISABLE_AUTH=false

# Start the MCP server (uses devDependency tsx)
CMD ["npm", "run", "start:ui"]
