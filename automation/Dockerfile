FROM node:24-bookworm-slim
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates
RUN npm install --global @openai/codex@0.153.4
USER node
WORKDIR /workspace
ENTRYPOINT ["timeout", "--signal=TERM", "--kill-after=10s", "30m", "codex"]
