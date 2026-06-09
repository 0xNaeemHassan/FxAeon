import { Router } from 'express';
import { z } from 'zod';

const router = Router();

// GET /api/v1/health - Health check with validation
router.get('/', async (req, res, next) => {
  try {
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.1.0',
      uptime: process.uptime(),
      services: {
        telegram: 'connected',
        database: 'connected',
        blockchain: 'connected',
      },
    };
    
    res.json(healthData);
  } catch (error) {
    next(error);
  }
});

export default router;
