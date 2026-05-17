import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import { processIncomingMessage } from './ai';
import './db'; // Initialize database

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Telegram Bot
const token = process.env.TELEGRAM_BOT_TOKEN;
let bot: TelegramBot | null = null;

if (token) {
  // polling: true makes the bot constantly check Telegram for new messages
  bot = new TelegramBot(token, { polling: true });
  console.log('Telegram Bot initialized and polling for messages.');

  // Handle incoming Telegram messages
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    console.log(`Received message from ${chatId}: ${text}`);

    try {
      console.log(`[${chatId}] Attempting to send chat action 'typing'...`);
      // Show "typing" indicator in Telegram
      // If it hangs here, we won't see the next log
      bot?.sendChatAction(chatId, 'typing').catch(e => console.error('ChatAction Error:', e));
      console.log(`[${chatId}] Sent chat action 'typing' (non-blocking).`);

      console.log(`[${chatId}] Processing message with AI...`);
      // Process message with our Gemini AI
      const aiResponse = await processIncomingMessage(chatId.toString(), text);
      
      console.log(`[${chatId}] Sending response...`);
      // Send the response back to the user
      await bot?.sendMessage(chatId, aiResponse);
      console.log(`[${chatId}] Response sent successfully.`);
    } catch (error) {
      console.error('Error handling Telegram message:', error);
      await bot?.sendMessage(chatId, 'Sorry, I am having technical difficulties right now.');
    }
  });
} else {
  console.warn('TELEGRAM_BOT_TOKEN not found in .env. Bot is not running.');
}

// Basic health check endpoint (Optional, good for keeping servers like Render awake)
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'AI Receptionist is running.' });
});

app.get('/test-trigger', async (req: Request, res: Response) => {
  const chatId = 6518334668;
  const text = "Hello from test trigger";
  console.log(`[TEST] Triggering message from ${chatId}: ${text}`);
  try {
    const aiResponse = await processIncomingMessage(chatId.toString(), text);
    res.status(200).json({ aiResponse });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`AI Receptionist background server is running on port ${port}`);
});
