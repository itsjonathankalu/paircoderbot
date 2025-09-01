require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { OpenAI } = require('openai');

console.log('Starting server...');
console.log('TELEGRAM_BOT_TOKEN exists:', !!process.env.TELEGRAM_BOT_TOKEN);
console.log('OPENROUTER_API_KEY exists:', !!process.env.OPENROUTER_API_KEY);

const app = express();
app.use(bodyParser.json());

// --- Bot Configuration ---
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const openRouterKey = process.env.OPENROUTER_API_KEY;
const telegramApi = `https://api.telegram.org/bot${telegramToken}`;
const webhookPath = '/new-message';

const openai = new OpenAI({
    apiKey: openRouterKey,
    baseURL: 'https://openrouter.ai/api/v1',
});

const availableModels = {
    'deepseek': 'deepseek/deepseek-r1:free',
    'qwen': 'qwen/qwen3-235b-a22b',
    'llama': 'meta-llama/llama-4-maverick',
    'gemini': 'google/gemini-2.5-pro',
    'mistral': 'mistralai/mistral-small-3.1-24b-instruct',
};
const defaultModel = 'deepseek/deepseek-r1:free';

let userModelChoices = {}; // In-memory store for user model preferences

// --- Bot Logic ---
app.post(webhookPath, async (req, res) => {
    const { message } = req.body;

    if (!message || !message.text) {
        return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const text = message.text;

    // --- Command Handling ---
    if (text.startsWith('/')) {
        const [command, arg] = text.substring(1).split(' ');

        if (command === 'models') {
            const modelList = Object.keys(availableModels).map(key => `- ${key}`).join('\n');
            const reply = `Available models:\n${modelList}\n\nType /setmodel <model_name> to choose one.`;
            await axios.post(`${telegramApi}/sendMessage`, { chat_id: chatId, text: reply });
            return res.sendStatus(200);
        }

        if (command === 'setmodel') {
            if (arg && availableModels[arg]) {
                userModelChoices[chatId] = availableModels[arg];
                const reply = `Model set to: ${arg}`;
                await axios.post(`${telegramApi}/sendMessage`, { chat_id: chatId, text: reply });
            } else {
                const reply = `Invalid model. Use /models to see the list of available models.`;
                await axios.post(`${telegramApi}/sendMessage`, { chat_id: chatId, text: reply });
            }
            return res.sendStatus(200);
        }
    }

    // --- Regular Message Handling ---
    try {
        await axios.post(`${telegramApi}/sendChatAction`, {
            chat_id: chatId,
            action: 'typing',
        });

        const userModel = userModelChoices[chatId] || defaultModel;

        const response = await openai.chat.completions.create({
            model: userModel,
            messages: [{ role: 'user', content: text }],
        });

        const reply = response.choices[0].message.content;

        await axios.post(`${telegramApi}/sendMessage`, {
            chat_id: chatId,
            text: reply,
        });

        res.sendStatus(200);
    } catch (error) {
        console.error('Error:', error);
        await axios.post(`${telegramApi}/sendMessage`, {
            chat_id: chatId,
            text: 'Sorry, something went wrong.',
        }).catch(err => console.error('Error sending error message:', err));
        res.sendStatus(500);
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Setting up webhook...');
    // NOTE: You need to run this command once locally after deploying your bot
    // to set the webhook. Replace YOUR_DEPLOYED_URL with your actual URL.
    // curl -F "url=https://YOUR_DEPLOYED_URL/new-message" https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook
    console.log(`Webhook setup command:`);
    console.log(`curl -F "url=<YOUR_DEPLOYED_URL>${webhookPath}" ${telegramApi}/setWebhook`);
});
