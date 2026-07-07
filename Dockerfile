FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Only expose the StreetView web app.
# The save/upload server still runs inside the container on 3010,
# but Vite proxies /api, /uploads, /data, and /health through port 5055.
EXPOSE 5055

ENV VITE_HOST=0.0.0.0
ENV VITE_PORT=5055
ENV SAVE_HOST=127.0.0.1
ENV SAVE_PORT=3010

CMD ["npm", "run", "dev"]
