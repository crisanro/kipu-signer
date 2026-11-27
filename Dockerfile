# Usamos una versión ligera de Node.js. 24 = LTS con parches hasta 2028
# (Node 20 dejó de recibirlos en abril de 2026)
FROM node:24-slim

# Instalamos dependencias del sistema necesarias para fuentes (PDFKit/Canvas)
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias primero para aprovechar el cache de Docker
COPY package*.json ./

# Instalar dependencias (solo producción, versiones exactas del lock)
RUN npm ci --omit=dev

# Copiar el resto del código del microservicio
COPY . .

# El puerto que definiste en tu index.js
EXPOSE 3000

# Correr sin root (usuario "node" que trae la imagen oficial)
USER node

# Sin esto, si se arranca solo con la imagen (sin docker-compose), Express
# devuelve el stack de los errores en la respuesta
ENV NODE_ENV=production

# Comando para arrancar
CMD ["node", "index.js"]