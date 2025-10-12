# Capsule Memory production container
FROM node:20-bullseye-slim AS base
ENV NODE_ENV=production
WORKDIR /app

# Install dependencies with dev tools for the build stage
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci

# Build the application (Modelence + SDK artifacts)
FROM deps AS build
COPY . .
RUN npm run build

# Prepare a slim runtime image with only production dependencies
FROM base AS runner
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled assets from the build stage
COPY --from=build /app/.modelence ./ .modelence
COPY --from=build /app/packages ./packages

EXPOSE 3000
CMD ["node", ".modelence/build/app.mjs"]
