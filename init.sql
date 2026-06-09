-- Initialize fxBot database
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Ensure proper encoding
SET client_encoding = 'UTF8';

-- Create indexes for common queries
-- (Prisma migrations will create tables, this adds custom optimizations)

-- Note: Run 'npx prisma migrate deploy' after database creation
