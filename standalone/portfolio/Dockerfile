FROM node:24.12.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node . .
USER node
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/app/data
EXPOSE 8080
CMD ["node", "server.mjs"]
