-- Migration: rename orders table columns to match zrexpress schema
-- Run this in Supabase SQL Editor

-- Orders table
ALTER TABLE orders RENAME COLUMN tracking TO tracking_number;
ALTER TABLE orders RENAME COLUMN client TO customer_name;
ALTER TABLE orders RENAME COLUMN whatsapp TO customer_whatsapp;
ALTER TABLE orders RENAME COLUMN product TO product_name;
ALTER TABLE orders RENAME COLUMN status TO delivery_status;

-- Messages table (denormalized columns referencing orders fields)
ALTER TABLE messages RENAME COLUMN tracking TO tracking_number;
ALTER TABLE messages RENAME COLUMN client TO customer_name;
ALTER TABLE messages RENAME COLUMN whatsapp TO customer_whatsapp;

-- Update indexes if they exist on old column names
DROP INDEX IF EXISTS idx_orders_tracking;
DROP INDEX IF EXISTS idx_orders_status;
CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON orders(tracking_number);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders(delivery_status);
CREATE INDEX IF NOT EXISTS idx_messages_tracking_number ON messages(tracking_number);
