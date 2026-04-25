'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Loader2, RotateCcw, Bot, Globe } from 'lucide-react';
import { useChatbot } from '@/contexts/ChatbotContext';
import type { SessionState } from '@/app/api/chatbot/route';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const INITIAL_STATE: SessionState = { intent: null, step: 'detect', data: {} };

const WELCOME = `السلام عليكم 👋 أنا المساعد الذكي لـ ZREXpress.

كيف يمكنني مساعدتك ؟
• 📦 تتبع طلبك — أرسل رقم التتبع
• 🛒 تقديم طلب جديد
• ❓ أسئلة حول خدماتنا
• 🔧 تسجيل شكوى`;

const QUICK_ACTIONS = [
  { label: '📦 Suivre ma commande', msg: 'Je veux suivre ma commande' },
  { label: '🛒 Nouvelle commande', msg: 'Je veux passer une commande' },
  { label: '🔄 Faire un retour', msg: 'Je veux faire un retour' },
  { label: '🔧 Signaler un problème', msg: 'J\'ai un problème avec ma livraison' },
];

export default function ChatbotDrawer() {
  const { isOpen, close } = useChatbot();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>(INITIAL_STATE);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{ role: 'assistant', content: WELCOME }]);
    }
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    if (!text) setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          sessionState,
          history: messages.slice(-8),
          channel: 'web',
        }),
      });

      const json = await res.json();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: json.reply || 'عذراً، حدث خطأ. حاول مجدداً.',
      }]);
      if (json.newState) setSessionState(json.newState);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Erreur de connexion. Vérifiez votre réseau et réessayez.',
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, sessionState]);

  const resetChat = () => {
    setMessages([{ role: 'assistant', content: WELCOME }]);
    setSessionState(INITIAL_STATE);
    setInput('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col w-[370px] max-h-[580px] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-500 text-white shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
            <Bot size={16} />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">ZREXpress Assistant</p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse" />
              <p className="text-[10px] opacity-80">En ligne · Réponse instantanée</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={resetChat}
            title="Nouvelle conversation"
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
          >
            <RotateCcw size={13} />
          </button>
          <button onClick={close} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Channel badge */}
      <div className="flex items-center gap-1.5 px-4 py-2 bg-gray-50 border-b border-gray-100 shrink-0">
        <Globe size={11} className="text-gray-400" />
        <span className="text-[11px] text-gray-500 font-medium">Chat Web · ZREXpress</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-2 shrink-0 mt-0.5">
                <Bot size={12} className="text-green-600" />
              </div>
            )}
            <div
              className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-green-600 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Quick actions shown only at start */}
        {messages.length === 1 && !loading && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {QUICK_ACTIONS.map(a => (
              <button
                key={a.label}
                onClick={() => sendMessage(a.msg)}
                className="text-[11px] px-2.5 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-full hover:border-green-400 hover:text-green-700 hover:bg-green-50 transition-all"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-2 shrink-0 mt-0.5">
              <Bot size={12} className="text-green-600" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 p-3 flex items-center gap-2 shrink-0">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Écrivez votre message..."
          className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 transition-all"
          disabled={loading}
          dir="auto"
        />
        <button
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading}
          className="w-9 h-9 bg-green-600 text-white rounded-xl flex items-center justify-center hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
