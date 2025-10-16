# Capsule Memory production container
FROM node:20-bullseye-slim AS base
ENV NODE_ENV=production
WORKDIR /app

# Install dependencies with dev tools for the build stage
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
RUN corepack enable && pnpm install --frozen-lockfile

# Build the application (Modelence + SDK artifacts)
FROM deps AS build
COPY . .
RUN pnpm run build

# Prepare a slim runtime image with only production dependencies
FROM base AS runner
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

# Copy compiled assets from the build stage
COPY --from=build /app/.modelence ./ .modelence
COPY --from=build /app/packages ./packages

EXPOSE 3000
CMD ["node", ".modelence/build/app.mjs"]
