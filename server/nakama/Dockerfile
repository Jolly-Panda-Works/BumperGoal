# Builds the FlickKick Go plugin with the pluginbuilder that matches the server
# exactly (a Go plugin must use the same Go and dependency versions as Nakama).
# Build context: repository root.
ARG NAKAMA_VERSION=3.41.0

FROM heroiclabs/nakama-pluginbuilder:${NAKAMA_VERSION} AS builder
ENV GO111MODULE=on CGO_ENABLED=1
WORKDIR /backend
COPY server/nakama/go.mod server/nakama/go.sum ./
RUN go mod download
COPY server/nakama/ ./
RUN go vet ./... && go build -trimpath -buildmode=plugin -o ./backend.so

FROM heroiclabs/nakama:${NAKAMA_VERSION}
COPY --from=builder /backend/backend.so /nakama/data/modules/backend.so
COPY server/nakama/flickkick.yml /nakama/data/flickkick.yml
