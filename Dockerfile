FROM node:24-alpine3.23

# Core utilities
RUN apk add --no-cache \
    ripgrep the_silver_searcher git bash grep curl findutils \
    tmux make cmake jq tree htop unzip wget \
    sqlite openssl procps \
    openssh-client \
    python3 patch php

# Node tooling
RUN npm install -g @vtsls/language-server oxfmt oxlint typescript

# Build helper (installs html-to-markdown)
COPY build.sh ./
RUN ./build.sh

RUN mkdir -p /home/node/.ssh && chown -R node:node /home/node/.ssh
COPY .ssh/config /home/node/.ssh/config

# Default workdir
WORKDIR /workspace
