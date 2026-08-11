FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json ./
RUN npm install

FROM dependencies AS frontend-build
WORKDIR /app
COPY . .
RUN npm run build

FROM nginx:1.29-alpine AS frontend
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health >/dev/null || exit 1

FROM dependencies AS backend
WORKDIR /app
ENV NODE_ENV=production

# Pannellum's official multires generator needs Python, Pillow, NumPy, and
# `nona` from Hugin. The generator is pinned to the same Pannellum release used
# by the frontend. These dependencies are only used locally inside the API
# container; panorama data is never sent outside the host.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates curl python3 python3-pil python3-numpy hugin-tools \
  && mkdir -p /opt/pannellum \
  && curl -fsSL \
       https://raw.githubusercontent.com/mpetroff/pannellum/2.5.7/utils/multires/generate.py \
       -o /opt/pannellum/generate.py \
  && sed -i 's/from distutils.spawn import find_executable/from shutil import which as find_executable/' /opt/pannellum/generate.py \
  && chmod 0755 /opt/pannellum/generate.py \
  && rm -rf /var/lib/apt/lists/*

COPY server ./server
COPY migration ./migration
COPY scripts ./scripts
COPY package.json ./package.json
RUN mkdir -p \
  /app/public/uploads/panos \
  /app/public/uploads/thumbs \
  /app/public/uploads/maps \
  /app/public/uploads/machines \
  /app/public/uploads/safety-popups \
  /tmp/riems-streetview
EXPOSE 3010
CMD ["node", "server/index.cjs"]
