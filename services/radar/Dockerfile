FROM rust:1.89-bookworm AS engine
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY engine ./engine
COPY data ./data
# build.rs expects the committed, verified Natural Earth fixtures unpacked.
COPY scripts/extract-fixtures.sh ./scripts/extract-fixtures.sh
RUN bash scripts/extract-fixtures.sh && cargo build --locked --release -p omastorm-engine

FROM node:24-bookworm-slim
# The engine's rustls client verifies against the system root store, which
# the slim image omits; without it the engine exits before binding its socket.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=engine /src/target/release/omastorm-engine /usr/local/bin/omastorm-engine
COPY services/radar ./services/radar
COPY engine/data/sites.json ./engine/data/sites.json
COPY web/src/radar/model.ts ./web/src/radar/model.ts
ENV PORT=8080 RADAR_STATE_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "services/radar/src/main.ts"]
