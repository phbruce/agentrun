BINARY := agentrun-bridge
VERSION := 0.1.0
LDFLAGS := -s -w -X main.version=$(VERSION)
BUILDFLAGS := CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)"

.PHONY: build build-all clean install

build:
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(BINARY) .

build-all:
	GOOS=darwin GOARCH=arm64 $(BUILDFLAGS) -o dist/$(BINARY)-darwin-arm64 .
	GOOS=darwin GOARCH=amd64 $(BUILDFLAGS) -o dist/$(BINARY)-darwin-amd64 .
	GOOS=linux  GOARCH=amd64 $(BUILDFLAGS) -o dist/$(BINARY)-linux-amd64 .
	GOOS=linux  GOARCH=arm64 $(BUILDFLAGS) -o dist/$(BINARY)-linux-arm64 .

install: build
	cp $(BINARY) /usr/local/bin/$(BINARY)

clean:
	rm -f $(BINARY)
	rm -rf dist/
