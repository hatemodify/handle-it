FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/broker/package.json apps/broker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN npm install
RUN npm run -w @orchestrator/shared build
RUN npm run -w @orchestrator/broker build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/apps/broker/dist ./dist
COPY --from=build /app/apps/broker/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8081
CMD ["node", "dist/index.js"]
