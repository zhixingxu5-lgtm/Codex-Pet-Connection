FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY services/sync-server/package.json services/sync-server/package.json
RUN pnpm install --frozen-lockfile --filter @petlink/protocol --filter @petlink/sync-server
COPY packages/protocol packages/protocol
COPY services/sync-server services/sync-server
RUN pnpm --filter @petlink/protocol build && pnpm --filter @petlink/sync-server build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/protocol ./packages/protocol
COPY --from=build /app/services/sync-server ./services/sync-server
CMD ["node", "services/sync-server/dist/main.js"]
