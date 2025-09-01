require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const rateLimit = require("express-rate-limit");

console.log("Starting server...");
console.log("TELEGRAM_BOT_TOKEN exists:", !!process.env.TELEGRAM_BOT_TOKEN);
console.log("GEMINI_API_KEY exists:", !!process.env.GEMINI_API_KEY);
console.log(
  "GOOGLE_SEARCH_API_KEY exists:",
  !!process.env.GOOGLE_SEARCH_API_KEY
);
console.log(
  "GOOGLE_SEARCH_ENGINE_ID exists:",
  !!process.env.GOOGLE_SEARCH_ENGINE_ID
);

const app = express();
app.use(bodyParser.json());

// --- CONFIGURATION ---
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;
const googleSearchKey = process.env.GOOGLE_SEARCH_API_KEY;
const googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

const telegramApi = `https://api.telegram.org/bot${telegramToken}`;
const webhookPath = "/new-message";

// --- QUOTA & CACHE ---
const GEMINI_DAILY_QUOTA = 200;
const SEARCH_DAILY_QUOTA = 500;
let geminiRequestCount = 0;
let searchRequestCount = 0;
const cache = new Map();

// Reset daily quotas every 24 hours
setInterval(() => {
  geminiRequestCount = 0;
  searchRequestCount = 0;
  console.log("Daily quotas have been reset.");
}, 24 * 60 * 60 * 1000);

// --- API CLIENTS ---
const genAI = new GoogleGenerativeAI(geminiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// --- RATE LIMITER ---
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15, // 15 requests per minute
  message: "Too many requests, please try again later.",
});

// --- HELPER FUNCTIONS ---
async function sendTypingAction(chatId) {
  await axios.post(`${telegramApi}/sendChatAction`, {
    chat_id: chatId,
    action: "typing",
  });
}

async function sendMessage(chatId, text) {
  await axios.post(`${telegramApi}/sendMessage`, {
    chat_id: chatId,
    text,
  });
}

async function performGoogleSearch(query) {
  if (searchRequestCount >= SEARCH_DAILY_QUOTA) {
    console.log("Google Search daily quota exceeded.");
    return null;
  }
  try {
    const response = await axios.get(
      "https://www.googleapis.com/customsearch/v1",
      {
        params: {
          key: googleSearchKey,
          cx: googleSearchEngineId,
          q: query,
        },
      }
    );
    searchRequestCount++;
    console.log(`Google Search requests: ${searchRequestCount}/${SEARCH_DAILY_QUOTA}`);
    if (response.data.items && response.data.items.length > 0) {
      return response.data.items[0].snippet;
    }
    return null;
  } catch (error) {
    console.error("Google Search Error:", error.message);
    return null;
  }
}

async function getGeminiResponse(text) {
  if (geminiRequestCount >= GEMINI_DAILY_QUOTA) {
    console.log("Gemini daily quota exceeded.");
    return "I've reached my daily limit for AI responses. Please try again tomorrow.";
  }
  try {
    const result = await model.generateContent(text);
    const response = await result.response;
    geminiRequestCount++;
    console.log(`Gemini requests: ${geminiRequestCount}/${GEMINI_DAILY_QUOTA}`);
    return response.text();
  } catch (error) {
    console.error("Gemini Error:", error);
    return "The AI is currently busy. Please try again in a minute.";
  }
}

// --- WEBHOOK HANDLER ---
app.post(webhookPath, limiter, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;

  try {
    await sendTypingAction(chatId);

    // 1. Check cache
    if (cache.has(text)) {
      console.log("Returning cached response.");
      await sendMessage(chatId, cache.get(text));
      return res.sendStatus(200);
    }

    // 2. Try Google Search first
    let reply = await performGoogleSearch(text);
    let source = "Google Search";

    // 3. If no good search result, fall back to Gemini
    if (!reply) {
      reply = await getGeminiResponse(text);
      source = "Gemini AI";
    }

    // 4. Cache the response
    if (reply) {
      cache.set(text, reply);
      // Optional: set a TTL for the cache
      setTimeout(() => cache.delete(text), 10 * 60 * 1000); // 10 minutes
    }

    console.log(`Responding with: ${source}`);
    await sendMessage(chatId, reply);

    res.sendStatus(200);
  } catch (error) {
    console.error("Main Handler Error:", error);
    try {
      await sendMessage(
        chatId,
        "The server is busy or overloaded. Please try again in a minute."
      );
    } catch (sendErr) {
      console.error("Error sending fallback message:", sendErr);
    }
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Webhook setup command:");
  console.log(
    `curl -F "url=<YOUR_DEPLOYED_URL>${webhookPath}" ${telegramApi}/setWebhook`
  );
});