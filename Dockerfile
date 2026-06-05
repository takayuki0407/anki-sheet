# --- build stage: produce the static site (dist/) ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Install deps first for layer caching. `scripts/` is needed because the
# postinstall hook copies pdf.js cMaps into public/.
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build

# --- serve stage: tiny nginx serving the static files ---
FROM nginx:1.27-alpine AS serve
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# Nothing server-side runs; the whole app executes in the user's browser.
