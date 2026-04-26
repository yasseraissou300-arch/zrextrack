const { LocalAuth } = require('whatsapp-web.js');
const Redis = require('ioredis');
const path = require('path');
const fs = require('fs');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const SESSION_PREFIX = 'zrex:wa:session:';
const SESSION_TTL = 60 * 60 * 24 * 30;

class SessionManager {
  constructor() {
    this.clients = new Map(); // userId -> { client, status, qr, phone }
  }

  async saveMeta(userId, meta) {
    await redis.setex(`${SESSION_PREFIX}${userId}`, SESSION_TTL,
      JSON.stringify({ ...meta, userId, updatedAt: Date.now() }));
  }

  async getMeta(userId) {
    const d = await redis.get(`${SESSION_PREFIX}${userId}`);
    return d ? JSON.parse(d) : null;
  }

  async deleteMeta(userId) {
    await redis.del(`${SESSION_PREFIX}${userId}`);
  }

  async listAll() {
    const keys = await redis.keys(`${SESSION_PREFIX}*`);
    const out = [];
    for (const k of keys) {
      const d = await redis.get(k);
      if (d) out.push(JSON.parse(d));
    }
    return out;
  }

  getSessionPath(userId) {
    return path.resolve(process.env.SESSION_PATH || './sessions', `session_${userId}`);
  }

  sessionExists(userId) {
    return fs.existsSync(this.getSessionPath(userId));
  }

  deleteLocalSession(userId) {
    const p = this.getSessionPath(userId);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }

  createAuth(userId) {
    return new LocalAuth({
      clientId: userId,
      dataPath: process.env.SESSION_PATH || './sessions',
    });
  }

  set(userId, data) { this.clients.set(userId, data); }
  get(userId) { return this.clients.get(userId); }
  remove(userId) { this.clients.delete(userId); }
  all() { return Array.from(this.clients.entries()); }
}

module.exports = new SessionManager();
