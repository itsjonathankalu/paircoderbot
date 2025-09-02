require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { Groq } = require("groq-sdk");

console.log("Starting server...");
console.log("TELEGRAM_BOT_TOKEN exists:", !!process.env.TELEGRAM_BOT_TOKEN);
console.log("GROQ_API_KEY exists:", !!process.env.GROQ_API_KEY);

const app = express();
app.use(bodyParser.json());

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const groqApiKey = process.env.GROQ_API_KEY;

const telegramApi = `https://api.telegram.org/bot${telegramToken}`;
const webhookPath = "/new-message";

// Initialize Groq client
const groq = new Groq({ apiKey: groqApiKey });

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

    // Get AI response from Groq
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: text,
        },
      ],
      model: "llama-3.1-8b-instant",
      temperature: 1,
      max_tokens: 8192,
      top_p: 1,
      stream: false,
      stop: null
    });
    const reply = chatCompletion.choices[0].message.content;

    // Send reply back to Telegram
    await axios.post(`${telegramApi}/sendMessage`, {
      chat_id: chatId,
      text: reply,
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("Groq Error:", error);
    try {
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: "Error, something went wrong try again later",
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
