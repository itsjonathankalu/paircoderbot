require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { Groq } = require("groq-sdk");
const { Redis } = require("@upstash/redis");
const { startPrompter } = require("./prompter");

console.log("Starting server...");
console.log("TELEGRAM_BOT_TOKEN exists:", !!process.env.TELEGRAM_BOT_TOKEN);
console.log("GROQ_API_KEY exists:", !!process.env.GROQ_API_KEY);
console.log("UPSTASH_REDIS_REST_URL exists:", !!process.env.UPSTASH_REDIS_REST_URL);
console.log("UPSTASH_REDIS_REST_TOKEN exists:", !!process.env.UPSTASH_REDIS_REST_TOKEN);

const app = express();
app.use(bodyParser.json());

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const groqApiKey = process.env.GROQ_API_KEY;

const telegramApi = `https://api.telegram.org/bot${telegramToken}`;
const webhookPath = "/new-message";

// Initialize Groq client
const groq = new Groq({ apiKey: groqApiKey });

// Initialize Upstash Redis client using REST API
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

console.log('✅ Upstash Redis client initialized');

// ========== REDIS MEMORY HELPER FUNCTIONS ==========

/**
 * Fetch user conversation memory from Redis
 * @param {string|number} chatId - Telegram chat ID
 * @returns {Array} - Array of message objects with role and content
 */
async function getUserMemory(chatId) {
  try {
    const data = await redis.get(`user:${chatId}:memory`);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error(`Error fetching memory for ${chatId}:`, error);
    return [];
  }
}

/**
 * Save user conversation memory to Redis with 1 year expiration
 * @param {string|number} chatId - Telegram chat ID
 * @param {Array} history - Array of message objects
 */
async function saveUserMemory(chatId, history) {
  try {
    // Auto-expire in 1 year (365 days in seconds)
    await redis.set(
      `user:${chatId}:memory`,
      JSON.stringify(history),
      { ex: 60 * 60 * 24 * 365 }
    );
  } catch (error) {
    console.error(`Error saving memory for ${chatId}:`, error);
  }
}

/**
 * Register or update user info in Redis
 * @param {string|number} chatId - Telegram chat ID
 * @param {string} firstName - User's first name
 */
async function registerUser(chatId, firstName) {
  try {
    const userKey = `user:${chatId}:info`;
    const exists = await redis.exists(userKey);
    
    if (!exists) {
      await redis.set(
        userKey,
        JSON.stringify({ chatId, name: firstName, registeredAt: new Date().toISOString() }),
        { ex: 60 * 60 * 24 * 365 } // 1 year
      );
      console.log(`✅ Registered new user: ${firstName} (${chatId})`);
    }
  } catch (error) {
    console.error(`Error registering user ${chatId}:`, error);
  }
}

/**
 * Truncate memory to last N messages to prevent token overflow
 * @param {Array} memory - Full conversation history
 * @param {number} maxMessages - Maximum number of messages to keep (default: 20)
 * @returns {Array} - Truncated memory
 */
function truncateMemory(memory, maxMessages = 20) {
  if (memory.length > maxMessages) {
    return memory.slice(-maxMessages);
  }
  return memory;
}

// ========== ENDPOINTS ==========

// Health check endpoint for Docker
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Root keepalive route
app.get("/", (req, res) => {
  res.status(200).send("Cody is alive! 🤖");
});

// Main webhook endpoint
app.post(webhookPath, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;
  const firstName = message.from?.first_name || "there";

  try {
    // Register user in Redis
    await registerUser(chatId, firstName);

    // Send "typing…" indicator to Telegram
    await axios.post(`${telegramApi}/sendChatAction`, {
      chat_id: chatId,
      action: "typing",
    });

    // Load conversation memory from Redis
    let memory = await getUserMemory(chatId);

    // Append user's new message to memory
    memory.push({ role: "user", content: text });

    // Truncate memory to last 20 messages to prevent token overflow
    memory = truncateMemory(memory, 20);

    // Get AI response from Groq with full conversation context
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are Cody, a friendly AI assistant. The user's name is ${firstName}. Reference previous messages if relevant. Keep the tone helpful and engaging.`
        },
        ...memory // Feed full conversation history
      ],
      model: "llama-3.1-8b-instant",
      temperature: 1,
      max_tokens: 8192,
      top_p: 1,
      stream: false,
      stop: null
    });

    const reply = chatCompletion.choices[0].message.content;

    // Append AI's response to memory
    memory.push({ role: "assistant", content: reply });

    // Save updated memory back to Redis
    await saveUserMemory(chatId, memory);

    // Send reply back to Telegram
    await axios.post(`${telegramApi}/sendMessage`, {
      chat_id: chatId,
      text: reply,
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing message:", error);
    try {
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: "Error, something went wrong. Please try again later.",
      });
    } catch (sendErr) {
      console.error("Error sending fallback message:", sendErr);
    }
    res.sendStatus(500);
  }
});

// ========== SERVER STARTUP ==========

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("📡 Webhook setup command:");
  console.log(
    `curl -F "url=<YOUR_DEPLOYED_URL>${webhookPath}" ${telegramApi}/setWebhook`
  );
  startPrompter();
});