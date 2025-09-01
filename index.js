require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

console.log("Starting server...");
console.log("TELEGRAM_BOT_TOKEN exists:", !!process.env.TELEGRAM_BOT_TOKEN);
console.log("GEMINI_API_KEY exists:", !!process.env.GEMINI_API_KEY);

const app = express();
app.use(bodyParser.json());

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;

const telegramApi = `https://api.telegram.org/bot${telegramToken}`;
const webhookPath = "/new-message";

// --- Quota Management ---
let searchRequests = 0;
let aiRequests = 0;
const SEARCH_QUOTA = 500;
const AI_QUOTA = 200;

function resetQuotas() {
  searchRequests = 0;
  aiRequests = 0;
  console.log("Daily quotas reset at", new Date().toISOString());
}

// Reset quotas every 24 hours
setInterval(resetQuotas, 24 * 60 * 60 * 1000);

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(geminiKey);

// Model for Google Search Grounding
const searchModel = genAI.getGenerativeModel({
  model: "gemini-pro",
  tools: [{ google_search: {} }],
});

// Model for standard AI responses (fallback)
const aiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

app.post(webhookPath, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;

  try {
    // Send "typing…" to Telegram
    await axios.post(`${telegramApi}/sendChatAction`, {
      chat_id: chatId,
      action: "typing",
    });

    let reply = "";
    let usedSource = "";

    // 1. Try Google Search Grounding first
    if (searchRequests < SEARCH_QUOTA) {
      searchRequests++;
      usedSource = "Google Search";
      console.log(
        `Using ${usedSource}. Request #${searchRequests}/${SEARCH_QUOTA}`
      );
      const result = await searchModel.generateContent(text);
      const response = await result.response;
      reply = response.text();
    }
    // 2. Fallback to Gemini AI
    else if (aiRequests < AI_QUOTA) {
      aiRequests++;
      usedSource = "Gemini AI";
      console.log(`Using ${usedSource}. Request #${aiRequests}/${AI_QUOTA}`);
      const result = await aiModel.generateContent(text);
      const response = await result.response;
      reply = response.text();
    }
    // 3. If all quotas are exhausted
    else {
      usedSource = "Quota Limit";
      console.log("Daily quotas exceeded.");
      reply =
        "Sorry, the bot has reached its daily limit. Please try again tomorrow.";
    }

    // Send reply back to Telegram
    await axios.post(`${telegramApi}/sendMessage`, {
      chat_id: chatId,
      text: reply,
    });

    console.log(`Replied to chat ${chatId} using ${usedSource}.`);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing message:", error);
    try {
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: "The server is busy or overloaded. Please try again in a minute.",
      });
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
  console.log(`Initial quotas: Search=${SEARCH_QUOTA}, AI=${AI_QUOTA}`);
});
