const { Client, Events } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const sessionManager = require('../sessions/SessionManager');
const messageQueue = require('../queue/MessageQueue');

const humanDelay = (min = 800, max = 3500) =>
  new Promise(r => setTimeout(r, Math.random() * (max - min) + min));

class WhatsAppClient {
  constructor(userId, io) {
    this.userId = userId;
    this.io = io;
  }

  emit(event, data) {
    this.io.to(`user:${this.userId}`).emit(event, { userId: this.userId, ...data });
  }

  async initialize() {
    const existing = sessionManager.get(this.userId);
    if (existing?.status === 'ready' || existing?.status === 'initializing') return;

    const client = new Client({
      authStrategy: sessionManager.createAuth(this.userId),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
               '--disable-accelerated-2d-canvas','--no-first-run','--disable-gpu'],
      },
    });

    sessionManager.set(this.userId, { client, status: 'initializing', qr: null, phone: null });
    await sessionManager.saveMeta(this.userId, { status: 'initializing', phone: null });

    // ── Événements ────────────────────────────────────────────────────────
    client.on(Events.QR_RECEIVED, async (qr) => {
      const qrBase64 = await qrcode.toDataURL(qr);
      sessionManager.set(this.userId, { ...sessionManager.get(this.userId), status: 'qr_pending', qr: qrBase64 });
      await sessionManager.saveMeta(this.userId, { status: 'qr_pending', phone: null });
      this.emit('qr', { qr: qrBase64 });
      console.log(`[${this.userId}] QR généré`);
    });

    client.on(Events.AUTHENTICATED, async () => {
      sessionManager.set(this.userId, { ...sessionManager.get(this.userId), status: 'authenticated', qr: null });
      this.emit('status', { status: 'authenticated' });
    });

    client.on(Events.READY, async () => {
      const phone = client.info?.wid?.user || null;
      sessionManager.set(this.userId, { ...sessionManager.get(this.userId), status: 'ready', phone });
      await sessionManager.saveMeta(this.userId, { status: 'ready', phone });
      this.emit('status', { status: 'ready', phone });
      console.log(`[${this.userId}] Prêt — ${phone}`);
    });

    client.on(Events.MESSAGE_RECEIVED, async (msg) => {
      if (msg.isStatus || msg.fromMe || msg.from.includes('@g.us')) return;
      const body = msg.body?.trim();
      if (!body) return;
      console.log(`[${this.userId}] Message entrant de ${msg.from}: ${body.slice(0, 50)}`);
      messageQueue.add(this.userId, { client, from: msg.from, body, msg });
    });

    client.on(Events.DISCONNECTED, async (reason) => {
      console.log(`[${this.userId}] Déconnecté: ${reason}`);
      sessionManager.set(this.userId, { ...sessionManager.get(this.userId), status: 'disconnected' });
      await sessionManager.saveMeta(this.userId, { status: 'disconnected', phone: null });
      this.emit('status', { status: 'disconnected' });
    });

    client.on(Events.AUTHENTICATION_FAILURE, async () => {
      sessionManager.deleteLocalSession(this.userId);
      await sessionManager.deleteMeta(this.userId);
      sessionManager.remove(this.userId);
      this.emit('status', { status: 'auth_failed' });
    });

    await client.initialize();
  }

  async sendMessage(to, message) {
    const s = sessionManager.get(this.userId);
    if (!s?.client || s.status !== 'ready') throw new Error('Session non prête');

    const chatId = to.includes('@') ? to : `${to}@c.us`;
    const chat = await s.client.getChatById(chatId);
    await chat.sendStateTyping();
    await humanDelay();
    await chat.clearState();
    await s.client.sendMessage(chatId, message);
  }

  async disconnect() {
    const s = sessionManager.get(this.userId);
    if (s?.client) {
      try { await s.client.destroy(); } catch {}
    }
    sessionManager.deleteLocalSession(this.userId);
    await sessionManager.deleteMeta(this.userId);
    sessionManager.remove(this.userId);
  }
}

module.exports = WhatsAppClient;
