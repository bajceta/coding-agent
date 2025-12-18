FROM node:24-alpine3.23
RUN apk add --no-cache ripgrep the_silver_searcher git bash grep curl findutils
