require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const sessionManager = require('./sessions/SessionManager');
const WhatsAppClient = require('./whatsapp/WhatsAppClient');
const messageQueue = require('./queue/MessageQueue');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET', 'POST'] },
});

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// ── Middleware auth backend secret ────────────────────────────────────────────
function requireSecret(req, res, next) {
  const secret = req.headers['x-backend-secret'];
  if (secret !== process.env.BACKEND_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Démarrer session WhatsApp (QR via Socket.io)
app.post('/api/connect/:userId', requireSecret, async (req, res) => {
  const { userId } = req.params;
  const existing = sessionManager.get(userId);
  if (existing?.status === 'ready') return res.json({ status: 'ready', phone: existing.phone });
  if (existing?.status === 'initializing') return res.json({ status: 'initializing' });

  const client = new WhatsAppClient(userId, io);
  client.initialize().catch(err => console.error(`[${userId}] Init error:`, err.message));

  res.json({ status: 'initializing' });
});

// Statut session
app.get('/api/status/:userId', requireSecret, async (req, res) => {
  const { userId } = req.params;
  const s = sessionManager.get(userId);
  const meta = await sessionManager.getMeta(userId);
  res.json({
    status: s?.status || meta?.status || 'disconnected',
    phone: s?.phone || meta?.phone || null,
    hasQr: !!s?.qr,
  });
});

// QR courant (fallback si Socket.io raté)
app.get('/api/qr/:userId', requireSecret, async (req, res) => {
  const { userId } = req.params;
  const s = sessionManager.get(userId);
  if (!s) return res.status(404).json({ error: 'Aucune session' });
  if (s.status === 'ready') return res.json({ status: 'ready' });
  res.json({ status: s.status, qr: s.qr || null });
});

// Envoyer message WhatsApp
app.post('/api/send/:userId', requireSecret, async (req, res) => {
  const { userId } = req.params;
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'to et message requis' });

  const client = new WhatsAppClient(userId, io);
  try {
    await client.sendMessage(to, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Déconnecter
app.post('/api/disconnect/:userId', requireSecret, async (req, res) => {
  const { userId } = req.params;
  const client = new WhatsAppClient(userId, io);
  await client.disconnect();
  res.json({ success: true });
});

// Health check
app.get('/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join', async ({ userId }) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
    // Envoyer statut + QR existant immédiatement
    const s = sessionManager.get(userId);
    if (s) {
      socket.emit('status', { userId, status: s.status, phone: s.phone });
      if (s.qr) socket.emit('qr', { userId, qr: s.qr });
    }
  });
});

// ── Restaurer sessions au démarrage ──────────────────────────────────────────
async function restore() {
  const sessions = await sessionManager.listAll();
  const toRestore = sessions.filter(s => s.status === 'ready');
  console.log(`[Boot] Restauration de ${toRestore.length} session(s)`);
  for (const meta of toRestore) {
    if (sessionManager.sessionExists(meta.userId)) {
      const client = new WhatsAppClient(meta.userId, io);
      client.initialize().catch(err =>
        console.error(`[Boot] Erreur ${meta.userId}:`, err.message)
      );
    }
  }
}

// ── Démarrage ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`🚀 ZRextrack WhatsApp Backend — http://localhost:${PORT}`);
  await restore();
});

process.on('SIGTERM', async () => {
  await messageQueue.closeAll();
  server.close(() => process.exit(0));
});
