FROM node:20-alpine

WORKDIR /app

ARG NPM_REGISTRY="https://registry.npmmirror.com"

# Make installs more resilient under flaky networks
RUN npm config set registry "${NPM_REGISTRY}" \
  && npm config set fetch-retries 6 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm config set audit false \
  && npm config set fund false

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["sh", "-c", "npm run dev -- -p ${PORT:-3000} -H 0.0.0.0"]
