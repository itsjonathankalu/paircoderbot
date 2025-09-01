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

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const openRouterKey = process.env.OPENROUTER_API_KEY;

const telegramApi = `https://api.telegram.org/bot${telegramToken}`;
const webhookPath = '/new-message';

const openai = new OpenAI({
    apiKey: openRouterKey,
    baseURL: 'https://openrouter.ai/api/v1',
});

app.post(webhookPath, async (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const text = message.text;

    if (!text) {
        return res.sendStatus(200);
    }

    try {
        // Send a 'typing...' action to let the user know the bot is working
        await axios.post(`${telegramApi}/sendChatAction`, {
            chat_id: chatId,
            action: 'typing',
        });

        const response = await openai.chat.completions.create({
            model: 'deepseek/deepseek-r1:free',
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
        // Optionally send an error message to the chat
        try {
            await axios.post(`${telegramApi}/sendMessage`, {
                chat_id: chatId,
                text: 'Sorry, something went wrong.',
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
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
