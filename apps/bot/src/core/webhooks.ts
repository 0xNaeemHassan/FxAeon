// INPUT VALIDATION: All user inputs must be validated with Zod schemas
import { Bot } from 'grammy';
import express from 'express';

export function setupWebhooks(bot: Bot, app: express.Application): void {
  // Telegram webhook endpoint
  app.post('/webhook/telegram', async (req, res) => {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).send('Error');
    }
  });
  
  // Blockchain event webhooks
  app.post('/webhook/blockchain', async (req, res) => {
    try {
      const { event, data } = req.body;
      // NOTE: Process blockchain events in production
      console.log(`Blockchain event: ${event}`, data);
      res.status(200).send('OK');
    } catch (error) {
      console.error('Blockchain webhook error:', error);
      res.status(500).send('Error');
    }
  });
}
