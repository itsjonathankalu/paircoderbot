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
    const factExtractionPrompt = `You are an expert fact extraction system. Extract ALL factual information about the user from their message.

Current known facts:
${JSON.stringify(currentFacts, null, 2)}

User's message: "${userMessage}"

CRITICAL RULES:
1. Extract EVERY piece of factual information - handle complex sentences with multiple facts
2. Use descriptive keys: age, full_name, first_name, last_name, occupation, years_experience, city, country, hobby, favorite_color, school, field_of_study, role, etc.
3. For experience: use "years_experience" with a number
4. For full names: extract full_name, first_name, and last_name separately
5. Update existing facts if new info contradicts them
6. Do NOT extract: questions, opinions, greetings, temporary states
7. Return ONLY valid JSON

EXAMPLES:

"I am 17" → {"age": 17}

"My name is Jonathan Kalu" → {"full_name": "Jonathan Kalu", "first_name": "Jonathan", "last_name": "Kalu"}

"I'm a software developer with 3 years of experience" → {"occupation": "software developer", "years_experience": 3}

"I want to tell you about myself - I'm Jonathan Kalu, a software developer, I created you, I'm 17 with 3 years of experience" → {
  "full_name": "Jonathan Kalu",
  "first_name": "Jonathan",
  "last_name": "Kalu",
  "occupation": "software developer",
  "age": 17,
  "years_experience": 3,
  "role": "creator"
}

"I love coding and my favorite color is blue" → {"hobby": "coding", "favorite_color": "blue"}

"How are you?" → {}

Extract ALL facts. Return ONLY JSON:`;

    const factExtraction = await groq.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: "You are an expert at extracting ALL factual information from text. Extract every fact from complex sentences. Return only valid JSON, no explanations." 
        },
        { 
          role: "user", 
          content: factExtractionPrompt 
        }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0, // Zero for maximum consistency
      max_tokens: 1000
    });

    const responseText = factExtraction.choices[0].message.content.trim();
    
    // Parse JSON, handling markdown code blocks
    let extractedFacts = {};
    try {
      const cleanedResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extractedFacts = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.log("⚠️ Could not parse facts:", responseText);
      extractedFacts = {};
    }

    // Merge with current facts
    const updatedFacts = { ...currentFacts, ...extractedFacts };
    
    // Log extracted facts
    if (Object.keys(extractedFacts).length > 0) {
      console.log(`📝 Extracted facts:`, extractedFacts);
    }

    return updatedFacts;
  } catch (error) {
    console.error("Error extracting facts:", error);
    return currentFacts;
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

    // Extract facts from the user's message BEFORE adding to chat
    memory.facts = await extractFacts(memory.facts, text, firstName);

    // Append user's new message to chat history
    memory.chat.push({ role: "user", content: text });

    // Truncate chat to last 20 messages
    memory.chat = truncateChat(memory.chat, 20);

    // Build comprehensive system prompt with ALL known facts
    let systemPrompt = `You are Cody, a friendly and intelligent AI assistant created by Jonathan Kalu.`;
    
    if (Object.keys(memory.facts).length > 0) {
      systemPrompt += `\n\nIMPORTANT - What you know about ${firstName}:\n${JSON.stringify(memory.facts, null, 2)}`;
      systemPrompt += `\n\nCRITICAL RULES:
- Use this information to answer questions accurately
- If asked about facts you know, answer confidently with the stored information
- Reference their name, age, occupation, experience, and other facts naturally
- Don't ask for information you already have
- Be personal and remember context from previous conversations`;
    } else {
      systemPrompt += `\n\nThe user's name is ${firstName}. Be helpful, engaging, and remember what they tell you.`;
    }

    // Get AI response with full context
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        ...memory.chat
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.8,
      max_tokens: 8192,
      top_p: 1,
      stream: false,
      stop: null
    });

    const reply = chatCompletion.choices[0].message.content;

    // Append AI's response to chat history
    memory.chat.push({ role: "assistant", content: reply });

    // Save updated memory back to Redis
    await saveUserMemory(chatId, memory);

    // Send reply to Telegram
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