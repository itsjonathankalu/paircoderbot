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

// --- Temporal Memory ---
const messageCache = new Map();
const MEMORY_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const MAX_TOKENS = 2000; // safe limit for memory context + new message

// Rough token estimate: 1 word ≈ 1.33 tokens
const estimateTokens = (messages) => {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.split(/\s+/).length * 1.33), 0);
};

const saveMessage = (chatId, role, content, userName) => {
  let chatData = messageCache.get(chatId) || { messages: [], timeout: null, userName };

  chatData.userName = userName; // update name if it changes
  chatData.messages.push({ role, content });

  // Keep last 10 messages only
  if (chatData.messages.length > 10) chatData.messages.shift();

  // Clear previous timeout if exists
  if (chatData.timeout) clearTimeout(chatData.timeout);

  // Set timeout to delete memory after inactivity
  chatData.timeout = setTimeout(() => {
    messageCache.delete(chatId);
    console.log(`Cleared memory for chat ID: ${chatId}`);
  }, MEMORY_TIMEOUT);

  messageCache.set(chatId, chatData);
};

const getConversationHistory = (chatId) => {
  const chatData = messageCache.get(chatId);
  return chatData ? chatData.messages : [];
};

// Trim memory messages to fit token limits
const getMemoryForPrompt = (chatId, newMessage) => {
  let history = getConversationHistory(chatId);
  const allMessages = [...history, { role: 'user', content: newMessage }];

  while (estimateTokens(allMessages) > MAX_TOKENS && allMessages.length > 1) {
    allMessages.shift(); // remove oldest message until safe
  }

  return allMessages;
};

app.post(webhookPath, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;
  const firstName = message.from?.first_name || "there"; // fetch Telegram first name

  try {
    // Save user message with their name
    saveMessage(chatId, "user", text, firstName);

    // Send "typing…" to Telegram
    await axios.post(`${telegramApi}/sendChatAction`, {
      chat_id: chatId,
      action: "typing",
    });

    // Prepare token-safe memory + new message
    const memoryMessages = getMemoryForPrompt(chatId, text);

    // Add system prompt for Cody persona + user name
    const chatData = messageCache.get(chatId);
    const messagesForGroq = [
      {
        role: "system",
        content: `You are Cody, a friendly AI assistant. The user's name is ${chatData.userName}. Greet them naturally using their name and reference previous messages if relevant. Keep the tone helpful and engaging.`
      },
      ...memoryMessages
    ];

    // Get AI response from Groq
    const chatCompletion = await groq.chat.completions.create({
      messages: messagesForGroq,
      model: "llama-3.1-8b-instant",
      temperature: 1,
      max_tokens: 8192,
      top_p: 1,
      stream: false,
      stop: null
    });

    const reply = chatCompletion.choices[0].message.content;

    // Save bot response
    saveMessage(chatId, "bot", reply, chatData.userName);

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
        text: "Error, something went wrong. Try again later.",
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