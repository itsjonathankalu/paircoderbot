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
 * Fetch user memory (chat + facts) from Redis
 * @param {string|number} chatId - Telegram chat ID
 * @returns {Object} - Object with chat history and user facts
 */
async function getUserMemory(chatId) {
  try {
    const data = await redis.get(`user:${chatId}:memory`);
    if (data) {
      return JSON.parse(data);
    }
    // Return default structure
    return {
      chat: [],
      facts: {}
    };
  } catch (error) {
    console.error(`Error fetching memory for ${chatId}:`, error);
    return { chat: [], facts: {} };
  }
}

/**
 * Save user memory (chat + facts) to Redis with 1 year expiration
 * @param {string|number} chatId - Telegram chat ID
 * @param {Object} memory - Object containing chat and facts
 */
async function saveUserMemory(chatId, memory) {
  try {
    // Auto-expire in 1 year (365 days in seconds)
    await redis.set(
      `user:${chatId}:memory`,
      JSON.stringify(memory),
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
 * Truncate chat history to last N messages to prevent token overflow
 * @param {Array} chat - Full conversation history
 * @param {number} maxMessages - Maximum number of messages to keep (default: 20)
 * @returns {Array} - Truncated chat
 */
function truncateChat(chat, maxMessages = 20) {
  if (chat.length > maxMessages) {
    return chat.slice(-maxMessages);
  }
  return chat;
}

/**
 * Extract user facts from the conversation using AI
 * @param {Object} currentFacts - Current user facts
 * @param {string} userMessage - New message from user
 * @param {string} firstName - User's first name
 * @returns {Object} - Updated facts object
 */
async function extractFacts(currentFacts, userMessage, firstName) {
  try {
    const factExtractionPrompt = `You are a fact extraction assistant. Extract ONLY new factual information about the user from their message.

Current known facts about the user:
${JSON.stringify(currentFacts, null, 2)}

User's new message: "${userMessage}"

Instructions:
1. Extract ONLY clear, factual information (age, name, location, occupation, hobbies, preferences, etc.)
2. Do NOT extract opinions, questions, or temporary states
3. Update existing facts if new information contradicts them
4. Return ONLY a JSON object with key-value pairs
5. If no new facts, return an empty object {}
6. Use simple keys like: age, name, city, country, occupation, hobby, favorite_color, etc.

Examples:
- "I am 17" → {"age": 17}
- "I live in Enugu" → {"city": "Enugu"}
- "My name is Jonathan" → {"name": "Jonathan"}
- "I love coding" → {"hobby": "coding"}
- "How are you?" → {}

Return ONLY valid JSON, nothing else:`;

    const factExtraction = await groq.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: "You extract structured factual information about users from their messages. Return only valid JSON." 
        },
        { 
          role: "user", 
          content: factExtractionPrompt 
        }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.1, // Low temperature for consistent extraction
      max_tokens: 500
    });

    const responseText = factExtraction.choices[0].message.content.trim();
    
    // Try to parse JSON, handling potential markdown code blocks
    let extractedFacts = {};
    try {
      // Remove markdown code blocks if present
      const cleanedResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extractedFacts = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.log("Could not parse facts, using empty object:", responseText);
      extractedFacts = {};
    }

    // Merge with current facts
    const updatedFacts = { ...currentFacts, ...extractedFacts };
    
    // Log if new facts were extracted
    if (Object.keys(extractedFacts).length > 0) {
      console.log(`📝 Extracted new facts for user:`, extractedFacts);
    }

    return updatedFacts;
  } catch (error) {
    console.error("Error extracting facts:", error);
    return currentFacts; // Return unchanged facts on error
  }
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

    // Load user memory (chat + facts) from Redis
    let memory = await getUserMemory(chatId);

    // Extract facts from the user's message
    memory.facts = await extractFacts(memory.facts, text, firstName);

    // Append user's new message to chat history
    memory.chat.push({ role: "user", content: text });

    // Truncate chat to last 20 messages to prevent token overflow
    memory.chat = truncateChat(memory.chat, 20);

    // Build system prompt with user facts
    const factsContext = Object.keys(memory.facts).length > 0
      ? `\n\nWhat you know about ${firstName}:\n${JSON.stringify(memory.facts, null, 2)}\n\nUse this information to answer their questions accurately and personally.`
      : "";

    const systemPrompt = `You are Cody, a friendly AI assistant. The user's name is ${firstName}.${factsContext}

Important:
- Reference previous messages and known facts when relevant
- If asked about information you know (from facts), answer confidently
- Keep the tone helpful, engaging, and personal
- Don't ask for information you already have in facts`;

    // Get AI response from Groq with full conversation context
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        ...memory.chat // Feed full conversation history
      ],
      model: "llama-3.1-8b-instant",
      temperature: 1,
      max_tokens: 8192,
      top_p: 1,
      stream: false,
      stop: null
    });

    const reply = chatCompletion.choices[0].message.content;

    // Append AI's response to chat history
    memory.chat.push({ role: "assistant", content: reply });

    // Save updated memory (chat + facts) back to Redis
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