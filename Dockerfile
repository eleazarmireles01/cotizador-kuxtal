# Debe coincidir con la versión de playwright en package.json (1.48.0):
# la imagen trae los builds de Chromium de esa versión ya instalados.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]
