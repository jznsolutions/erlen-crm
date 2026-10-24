FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
VOLUME /app/data
EXPOSE 3000
CMD ["node", "src/server.js"]
