FROM node:24-bookworm-slim
RUN npm install --global @openai/codex@0.153.4
USER node
WORKDIR /workspace
ENTRYPOINT ["codex"]
