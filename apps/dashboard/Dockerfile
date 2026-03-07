FROM node:20-alpine AS build
WORKDIR /app
COPY . .
ENV DATABASE_URL=postgresql://placeholder/placeholder
ENV SESSION_SECRET=build-placeholder
ENV DASHBOARD_STREAM_TOKEN_SECRET=build-placeholder
ENV AGENT_KEY_PEPPER=build-placeholder
ENV BROKER_INTERNAL_SECRET=build-placeholder
ENV LOCAL_DEV_AUTH_BYPASS=true
RUN npm install
RUN npm run -w @orchestrator/shared build
RUN npm run -w @orchestrator/dashboard build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/dashboard/.next ./.next
COPY --from=build /app/apps/dashboard/public ./public
COPY --from=build /app/apps/dashboard/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
