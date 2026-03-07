FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN npm install
RUN npm run -w @orchestrator/shared build
RUN npm run -w @orchestrator/agent build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/apps/agent/dist ./dist
COPY --from=build /app/apps/agent/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
