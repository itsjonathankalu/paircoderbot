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

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(geminiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

    // Get AI response from Gemini
    const result = await model.generateContent(text);
    const response = await result.response;
    const reply = response.text();

    // Send reply back to Telegram
    await axios.post(`${telegramApi}/sendMessage`, {
      chat_id: chatId,
      text: reply,
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("Gemini Error:", error);
    try {
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: "Sorry, something went wrong. Try again late.",
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
});
