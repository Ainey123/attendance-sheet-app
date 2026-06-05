# Use official Node 20 LTS Alpine image
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package.json and install production dependencies only
COPY package.json ./
RUN npm ci --only=production

# Copy rest of the application code
COPY . .

# Expose the port (Render provides $PORT environment variable)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
