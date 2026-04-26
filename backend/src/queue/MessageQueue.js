const Bull = require('bull');
const AIAgent = require('../ai/AIAgent');

// Historique conversations : userId:phone → messages[]
const histories = new Map();

function historyKey(userId, phone) { return `${userId}:${phone}`; }

function addHistory(userId, phone, role, content) {
  const key = historyKey(userId, phone);
  if (!histories.has(key)) histories.set(key, []);
  const h = histories.get(key);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}

function getHistory(userId, phone) {
  return histories.get(historyKey(userId, phone)) || [];
}

class MessageQueue {
  constructor() {
    this.queues = new Map();
    this.agents = new Map();
  }

  getQueue(userId) {
    if (this.queues.has(userId)) return this.queues.get(userId);

    const queue = new Bull(`zrex:wa:${userId}`, {
      redis: process.env.REDIS_URL || 'redis://localhost:6379',
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    });

    // concurrency = 1 → anti-ban (un message à la fois par utilisateur)
    queue.process(1, async (job) => this._process(job.data));
    queue.on('failed', (job, err) =>
      console.error(`[Queue:${userId}] Échec job ${job.id}: ${err.message}`)
    );

    this.queues.set(userId, queue);
    return queue;
  }

  getAgent(userId) {
    if (!this.agents.has(userId)) this.agents.set(userId, new AIAgent());
    return this.agents.get(userId);
  }

  add(userId, data) {
    const delay = Math.floor(Math.random() * 3000) + 1000; // 1-4s anti-ban
    this.getQueue(userId).add({ userId, ...data }, { delay });
  }

  async _process({ userId, from, body, client }) {
    const phone = from.replace('@c.us', '');
    addHistory(userId, phone, 'user', body);

    try {
      const agent = this.getAgent(userId);
      const result = await agent.respond(getHistory(userId, phone), { userId, phone });
      addHistory(userId, phone, 'assistant', result.text);

      // Simuler frappe humaine
      const chat = await client.getChatById(from);
      await chat.sendStateTyping();
      const typingMs = Math.min(result.text.length * 25, 4000);
      await new Promise(r => setTimeout(r, typingMs));
      await chat.clearState();

      await client.sendMessage(from, result.text);

    } catch (err) {
      console.error(`[Queue:${userId}] Erreur IA:`, err.message);
      try {
        await client.sendMessage(from, 'عذراً، واجهت مشكلة تقنية. يرجى المحاولة مرة أخرى 🙏');
      } catch {}
    }
  }

  async closeAll() {
    for (const q of this.queues.values()) await q.close();
  }
}

module.exports = new MessageQueue();
