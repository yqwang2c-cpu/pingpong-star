FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY scores.json ./scores.json

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "start"]
