FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    netcat-openbsd \
    dnsutils \
    whois \
    traceroute \
    iputils-ping \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src/ ./src/

EXPOSE 3000

RUN useradd -m mcpuser && \
    mkdir -p /host-home && \
    chown -R mcpuser /app /host-home

USER mcpuser

CMD ["bun", "src/server.ts"]
