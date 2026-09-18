FROM node:24-alpine

WORKDIR /app
COPY package.json ./
COPY server.js tour-island-service.js api-config.js api-env.js public-config.js date-utils.js trip-utils.js ./
COPY index.html map.html kakao-map-config.js ./
COPY service-info.html ./
COPY refresh-tour-data.mjs ./
COPY snapshot-files.js ./
COPY submission-check.mjs ./
RUN mkdir -p data
COPY data/ferry-api.json data/weather-api.json ./data/

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 4173

CMD ["node", "server.js"]
