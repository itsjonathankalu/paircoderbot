require("dotenv").config();
const axios = require("axios");
const { Groq } = require("groq-sdk");
const fs = require("fs");

const groqApiKey = process.env.GROQ_API_KEY;
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramApi = `https://api.telegram.org/bot${telegramToken}`;

const groq = new Groq({ apiKey: groqApiKey });

const generateCheckIn = async (name) => {
  const chatCompletion = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: "You are Cody, a friendly AI assistant. Your task is to generate a short, friendly check-in message to a user. Ask them how their day is going or something similar. The user's name is provided."
      },
      {
        role: "user",
        content: `User's name: ${name}`,
      },
    ],
    model: "llama-3.1-8b-instant",
  });
  return chatCompletion.choices[0].message.content;
};

const startPrompter = () => {
  const userBatches = JSON.parse(fs.readFileSync("./users.json", "utf-8"));

  const TOTAL_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const batches = Object.keys(userBatches);
  if (batches.length === 0) {
      return;
  }
  const batchInterval = TOTAL_INTERVAL / batches.length;

  console.log("Starting one-time prompter test...");
  batches.forEach((batchName, index) => {
    setTimeout(async () => {
      const users = userBatches[batchName];
      console.log(`Processing batch: ${batchName}`);
      for (const user of users) {
        try {
          const message = await generateCheckIn(user.name);
          await axios.post(`${telegramApi}/sendMessage`, {
            chat_id: user.chatId,
            text: message,
          });
          console.log(`Pinged ${user.name} from ${batchName}`);
        } catch (err) {
          console.error(`Error sending batch ping to ${user.name}:`, err.response ? err.response.data : err.message);
        }
      }
    }, index * batchInterval);
  });
};

module.exports = { startPrompter };
