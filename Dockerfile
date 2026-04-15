# Usamos una versión ligera de Node.js
FROM node:20-slim

# Instalamos dependencias del sistema necesarias para fuentes (PDFKit/Canvas)
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias primero para aprovechar el cache de Docker
COPY package*.json ./

# Instalar dependencias (solo producción para que sea ligero)
RUN npm install --production

# Copiar el resto del código del microservicio
COPY . .

# El puerto que definiste en tu index.js
EXPOSE 3000

# Comando para arrancar
CMD ["node", "index.js"]