FROM node:24-alpine3.23
RUN apk add --no-cache ripgrep the_silver_searcher git bash grep curl findutils
RUN npm install -g @vtsls/language-server oxfmt oxlint typescript
RUN apk add --no-cache python3
