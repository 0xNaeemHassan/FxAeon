import { Router } from 'express';
import { z } from 'zod';

const router = Router();

const gasEstimateSchema = z.object({
  txType: z.enum(['open', 'close', 'adjust', 'leverage']).optional(),
  asset: z.string().optional(),
  size: z.number().positive().optional(),
});

// GET /api/v1/gas/estimate - Get gas estimate for transaction
router.get('/estimate', async (req, res, next) => {
  try {
    const query = gasEstimateSchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: query.error.issues });
    }
    
    const { txType, asset, size } = query.data;
    
    const baseGas = 21000;
    const complexityMultiplier = txType === 'leverage' ? 5 : 2;
    const estimatedGas = baseGas * complexityMultiplier;
    
    res.json({
      estimatedGas,
      gasPrice: '20',
      totalCost: '0.0021',
      txType: txType || 'standard',
      asset: asset || 'ETH',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/gas/prices - Current gas prices
router.get('/prices', async (req, res, next) => {
  try {
    res.json({
      slow: '15',
      standard: '20',
      fast: '30',
      rapid: '50',
      unit: 'gwei',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
