FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 5055
EXPOSE 3010

CMD ["sh", "-c", "node scripts/save-mapdata-server.cjs & npx vite --host 0.0.0.0 --port 5055"]