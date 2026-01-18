FROM node:18-alpine

WORKDIR /app

# copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# copy .env.example as default .env
RUN cp .env.example .env

# Create data and image catalogs
RUN mkdir -p data public/images

# exposed port
EXPOSE 8045

# Start application
CMD ["sh", "-c", "node src/config/init-env.js && npm start"]