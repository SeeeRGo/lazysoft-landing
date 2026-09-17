FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY astro.config.mjs tsconfig.json ./
COPY public ./public
COPY src ./src

ARG PUBLIC_YANDEX_METRIKA_ID
ENV PUBLIC_YANDEX_METRIKA_ID=$PUBLIC_YANDEX_METRIKA_ID

ARG PUBLIC_SITE_OFFER_VARIANT=standard
ENV PUBLIC_SITE_OFFER_VARIANT=$PUBLIC_SITE_OFFER_VARIANT

RUN npm run build

FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY server.mjs ./server.mjs
COPY --from=build /app/dist ./dist

USER node

EXPOSE 8080

CMD ["node", "server.mjs"]
