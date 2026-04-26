const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'check_order_status',
      description: "Vérifie le statut d'une commande ZREXpress par numéro de tracking",
      parameters: {
        type: 'object',
        properties: {
          tracking_number: { type: 'string', description: 'Numéro de tracking (ex: ZR-XXXXXX)' },
        },
        required: ['tracking_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transfer_to_human',
      description: "Transfère vers un agent humain si la demande est complexe ou urgente",
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
        },
        required: ['reason'],
      },
    },
  },
];

// Exécution des outils avec les données réelles de Supabase
async function executeTool(name, args, context) {
  if (name === 'check_order_status') {
    // Appel vers Next.js pour récupérer la commande depuis Supabase
    try {
      const res = await fetch(
        `${process.env.FRONTEND_URL}/api/track/${args.tracking_number}`
      );
      if (!res.ok) return `Commande ${args.tracking_number} introuvable.`;
      const data = await res.json();
      const statusLabels = {
        en_preparation: 'En préparation',
        en_transit: 'En transit',
        en_livraison: 'En cours de livraison',
        livre: 'Livrée ✅',
        echec: 'Échec de livraison ⚠️',
        retourne: 'Retournée',
      };
      return `Commande ${args.tracking_number} : ${statusLabels[data.status] || data.status} — ${data.wilaya || ''}`;
    } catch {
      return `Impossible de vérifier la commande ${args.tracking_number}`;
    }
  }

  if (name === 'transfer_to_human') {
    return `TRANSFER:${args.reason}`;
  }

  return 'Action inconnue';
}

class AIAgent {
  constructor(systemPrompt) {
    this.systemPrompt = systemPrompt ||
      `Nta assistant livraison dial ZREXpress f l'Algérie.
- Jaweb bDarija Algérienne (dialecte algérien)
- Wjiz — maximum 2-3 jmla
- Waqt livraison: 24 l 72 sa3a
- F cas problème: sol 3la raqm tracking dyalo
- Soyez rassurant et professionnel
Date: ${new Date().toLocaleDateString('fr-DZ')}`;
  }

  async respond(messages, context = {}) {
    const history = [
      { role: 'system', content: this.systemPrompt },
      ...messages,
    ];

    let response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: history,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 300,
    });

    let choice = response.choices[0];
    let turns = 0;

    while (choice.finish_reason === 'tool_calls' && turns < 3) {
      turns++;
      history.push(choice.message);

      for (const call of choice.message.tool_calls) {
        const args = JSON.parse(call.function.arguments);
        const result = await executeTool(call.function.name, args, context);

        if (result.startsWith('TRANSFER:')) {
          return { text: 'واش تبقى نحول ليك مع فريقنا، هما يساعدوك أكثر 🙏', transfer: true };
        }

        history.push({ role: 'tool', tool_call_id: call.id, content: result });
      }

      response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: history,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 300,
      });
      choice = response.choices[0];
    }

    return { text: choice.message.content || 'مفهمتكش، عاود كتب 🙏', transfer: false };
  }
}

module.exports = AIAgent;
