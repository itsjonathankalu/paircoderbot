require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { Groq } = require("groq-sdk");
const fs = require("fs");
const { startPrompter } = require("./prompter");

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
  const firstName = message.from?.first_name || "there"; // fetch Telegram first name

  // Dynamic user registration
  const usersFilePath = "./users.json";
  let users = {};
  try {
    const usersData = fs.readFileSync(usersFilePath, "utf-8");
    users = JSON.parse(usersData);
  } catch (error) {
    // If file doesn't exist, it will be created
  }

  const userExists = Object.values(users).some(batch => batch.some(user => user.chatId === chatId));

  if (!userExists) {
    const newUser = { chatId, name: firstName };
    const batchKeys = Object.keys(users);
    let targetBatch = "batch1";

    if (batchKeys.length > 0) {
        const lastBatch = batchKeys[batchKeys.length - 1];
        if (users[lastBatch].length >= 2) {
            targetBatch = `batch${batchKeys.length + 1}`;
        } else {
            targetBatch = lastBatch;
        }
    } 

    if (!users[targetBatch]) {
      users[targetBatch] = [];
    }
    users[targetBatch].push(newUser);

    try {
      fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
      console.log(`Added new user ${firstName} to ${targetBatch}`);
    } catch (error) {
      console.error("Error writing to users.json:", error);
    }
  }

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
          role: "system",
          content: `You are Cody, a friendly AI assistant. The user's name is ${firstName}. Greet them naturally using their name and reference previous messages if relevant. Keep the tone helpful and engaging.`
        },
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
  startPrompter();
});