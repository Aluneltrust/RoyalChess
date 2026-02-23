FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npx tsc --listEmittedFiles && ls -la dist/

# Prune dev deps after build
RUN npm prune --omit=dev

EXPOSE 3001

CMD ["node", "dist/index.js"]