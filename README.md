# Telegram Bot API with Node.js and Groq AI

<p align="left">
  <a href="https://t.me/paircoderbot">
    <img src="https://img.shields.io/badge/Try%20it%20live-on%20Telegram-blue.svg?style=for-the-badge&logo=telegram" alt="Try it live on Telegram">
  </a>
</p>

A simple, but extensible Node.js implementation for a Telegram Bot that uses the Groq API to generate intelligent responses.

## Features

- **Telegram Integration**: Connects to the Telegram Bot API using webhooks.
- **AI-Powered Responses**: Uses the Groq API to generate responses with the `llama-3.1-8b-instant` model.
- **Conversation Memory**: Remembers chat history using Redis/Upstash for persistent, context-aware conversations.
- **Auto-Truncation**: Keeps last 20 messages to prevent token overflow while maintaining context.
- **User Registration**: Automatically registers users in Redis with 1-year data retention.
- **Easy to Set Up**: Get your bot running in a few simple steps.
- **Extensible**: The code is simple and can be easily extended with more features.

## Getting Started

This guide will walk you through setting up and running your own instance of this Telegram bot.

### Prerequisites

Before you begin, you will need the following:

- **Node.js**: Make sure you have Node.js installed on your system. You can download it from [nodejs.org](https://nodejs.org/).
- **Telegram Bot Token**: You need to get a bot token from the [@BotFather](https://t.me/BotFather) on Telegram.
- **Groq API Key**: You need an API key from [Groq](https://console.groq.com/keys).
- **Upstash Redis**: Create a free Redis database at [Upstash](https://console.upstash.io/) for conversation memory.
- **Public URL**: You need a publicly accessible URL for Telegram to send updates to. For local development, you can use a tool like [ngrok](https://ngrok.com/).

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/itsjonathankalu/paircoderbot.git
    cd paircoderbot
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

### Configuration

1.  **Create a `.env` file:**
    In the project root, create a file named `.env`. You can copy the example file:

    ```bash
    cp .env.example .env
    ```

2.  **Edit the `.env` file:**
    Open the `.env` file and add your credentials:
    ```
    TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
    GROQ_API_KEY=YOUR_GROQ_API_KEY
    UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
    UPSTASH_REDIS_REST_TOKEN=YOUR_UPSTASH_REST_TOKEN
    ```
    Replace the placeholders with your actual tokens:
    - `YOUR_TELEGRAM_BOT_TOKEN` - Get from [@BotFather](https://t.me/BotFather)
    - `YOUR_GROQ_API_KEY` - Get from [Groq Console](https://console.groq.com/keys)
    - Upstash credentials - Get from [Upstash Console](https://console.upstash.io/) → Your Database → REST API section


### Running Locally

For development and testing, you can run the bot on your local machine. Since Telegram webhooks require a public URL, you can use a tool like [ngrok](https://ngrok.com/) to expose your local server to the internet.

1.  **Start the server:**

    ```bash
    node index.js
    ```

    The server will start on port 3000.

2.  **Expose your local server with ngrok:**
    In a new terminal window, run:

    ```bash
    ngrok http 3000
    ```

    ngrok will give you a public URL (e.g., `https://random-string.ngrok.io`).

3.  **Set up the webhook:**
    Use the public URL from ngrok to tell Telegram where to send messages.

    ```bash
    curl -F "url=https://<YOUR_NGROK_URL>/new-message" https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook
    ```

    Replace `<YOUR_NGROK_URL>` with the URL from ngrok and `<YOUR_TELEGRAM_BOT_TOKEN>` with your bot's token.

    Now, any messages sent to your bot will be forwarded to your local server.

## Deployment

For your bot to work 24/7 without needing your computer to be on, you need to deploy it to a hosting service. This will give you a stable, public URL. We'll use [Railway](https://railway.app/) as an example.

### Why Deploy?

- **Always On**: Your bot will be online even when your computer is off.
- **Stable URL**: You get a permanent public URL for your webhook.
- **Scalability**: Hosting services can handle more traffic than your local machine.

### Deploying to Railway

1.  **Sign up for Railway**: Create an account on [railway.app](https://railway.app/). You can sign up with your GitHub account.

2.  **Create a New Project**:

    - Go to your Railway dashboard and click "New Project".
    - Select "Deploy from GitHub repo".
    - Choose the repository for this bot.

3.  **Configure Environment Variables**:

    - In your Railway project, go to the "Variables" tab.
    - Add the same environment variables as in your `.env` file:
      - `TELEGRAM_BOT_TOKEN`
      - `GROQ_API_KEY`
    - Railway will automatically use these variables when it runs your application.

4.  **Deploy**:
    Railway will automatically detect that it's a Node.js project and deploy it. It will use the `start` script in your `package.json`. If you don't have a `start` script, make sure to add one:

    ```json
    "scripts": {
      "start": "node index.js"
    }
    ```

5.  **Get Your Public URL**:
    Once deployed, Railway will provide you with a public URL for your service (e.g., `my-telegram-bot.up.railway.app`).

### Set the Webhook for Production

Now that you have your public URL from Railway, you need to tell Telegram to use it for your bot's webhook.

You will use the `curl` command, just like for local development, but with your production URL.

```bash
curl -F "url=https://<YOUR_RAILWAY_APP_URL>/new-message" https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook
```

Replace `<YOUR_RAILWAY_APP_URL>` with the URL you got from Railway and `<YOUR_TELEGRAM_BOT_TOKEN>` with your bot's token.

Once you run this command, your bot is live and will respond to messages using your deployed server on Railway.

## Usage

Once the bot is running and the webhook is set, you can open Telegram and start a conversation with your bot. Any message you send will be processed by the Groq API, and you will receive an AI-generated response.

### Beyond the Chatbot

This repository provides a solid foundation for various types of Telegram bots, not just chatbots. By modifying the logic in the `/new-message` route in `index.js`, you can create a wide range of applications. Here are a few ideas:

- **Content Delivery Bot**: Create a bot that sends daily news, weather updates, or motivational quotes.
- **To-Do List Bot**: Build a personal assistant that helps you manage your tasks.
- **Language Translator**: Use a translation API to create a bot that translates messages between different languages.
- **Image Search Bot**: Integrate with an image API (like Freepik, Unsplash, or Pexels) to build a bot that can find and send images based on user queries.
- **Integration Bot**: Connect to other services like Google Calendar, Trello, or GitHub to create a bot that sends notifications or manages tasks.
- **Quiz or Poll Bot**: Create a bot that can conduct quizzes or polls in a group chat.

The basic setup for receiving messages and sending replies is already in place. You just need to change what happens when a message is received.

## Model and Rate Limits

This bot uses the `llama-3.1-8b-instant` model from Groq. The free tier of the Groq API has the following rate limits for this model:

- **30 requests/minute**
- **~14,400 requests/day**
- **6K tokens/minute**
- **500K tokens/day**

If the bot doesn't respond, it's likely that the daily limit has been reached. In this case, please try again later.

## Project Structure

- `index.js`: The main entry point of the application. It contains the Express server, the webhook handler, Redis integration for conversation memory, and the logic for interacting with the Telegram and Groq APIs.
- `prompter.js`: Handles automated check-in messages to registered users in batches.
- `package.json`: Defines the project's metadata and lists the dependencies.
- `.env`: Stores the API keys and other secret credentials. This file is not committed to version control.
- `.env.example`: An example file for the environment variables.

## Dependencies

This project uses the following main dependencies:

- [express](https://expressjs.com/): A fast, unopinionated, minimalist web framework for Node.js.
- [axios](https://axios-http.com/): A promise-based HTTP client for the browser and Node.js.
- [groq-sdk](https://github.com/groq/groq-node): The official Node.js SDK for the Groq API.
- [@upstash/redis](https://github.com/upstash/upstash-redis): Serverless Redis client for Upstash with REST API support.
- [dotenv](https://github.com/motdotla/dotenv): A zero-dependency module that loads environment variables from a `.env` file into `process.env`.
