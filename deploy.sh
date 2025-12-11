#!/bin/bash

# Deployment script for PairCoderBot
echo "🚀 Starting PairCoderBot deployment..."

# Check if required environment variables are set
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo "❌ Error: TELEGRAM_BOT_TOKEN environment variable is not set"
    exit 1
fi

if [ -z "$GROQ_API_KEY" ]; then
    echo "❌ Error: GROQ_API_KEY environment variable is not set"
    exit 1
fi

if [ -z "$UPSTASH_REDIS_REST_URL" ]; then
    echo "❌ Error: UPSTASH_REDIS_REST_URL environment variable is not set"
    exit 1
fi

if [ -z "$UPSTASH_REDIS_REST_TOKEN" ]; then
    echo "❌ Error: UPSTASH_REDIS_REST_TOKEN environment variable is not set"
    exit 1
fi

echo "✅ Environment variables are set"

# Build the Docker image
echo "🔨 Building Docker image..."
docker build -t paircoderbot:latest .

if [ $? -eq 0 ]; then
    echo "✅ Docker image built successfully"
else
    echo "❌ Docker build failed"
    exit 1
fi

# Run the container
echo "🏃 Starting container..."
docker run -d \
    --name paircoderbot \
    --restart unless-stopped \
    -p 3000:3000 \
    -e TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
    -e GROQ_API_KEY="$GROQ_API_KEY" \
    -e UPSTASH_REDIS_REST_URL="$UPSTASH_REDIS_REST_URL" \
    -e UPSTASH_REDIS_REST_TOKEN="$UPSTASH_REDIS_REST_TOKEN" \
    -e NODE_ENV=production \
    -e PORT=3000 \
    paircoderbot:latest

if [ $? -eq 0 ]; then
    echo "✅ Container started successfully"
    echo "🌐 Bot is running on port 3000"
    echo "📊 Check container status with: docker ps"
    echo "📋 View logs with: docker logs paircoderbot"
else
    echo "❌ Failed to start container"
    exit 1
fi

echo "🎉 Deployment completed successfully!"
