/**
 * Local sender-trust graph and the deterministic digest. The graph scores
 * by RELATIONSHIP, not content: bidirectional exchange volume, replies in
 * both directions, recency - plus bulk/notification detection from
 * List-Unsubscribe and sender-local patterns. No cloud ML, no feature
 * phone-home: your mailbox statistics stay in the plugin data directory.
 * Pure functions over analyzed-message records.
 */

const NOTIFICATION_LOCALS = /^(?:no-?reply|noreply|donotreply|do-not-reply|notificaciones|notifications|info|hello|hi|mail|news|updates?|billing|facturacion|cobros|cuenta|account|soporte|support|alertas?|alerts?)$/iu;
const AUTOMATION_DOMAINS = /(?:\.sendgrid\.net|\.mailgun\.org|\.amazonses\.com|\.mandrillapp\.com|\.mailchimp\.com|\.brevo\.com|\.cysend|\.rdto\.me)$/iu;

/**
 * Build (or merge into) the graph. Records: { direction: "in"|"out",
 * from, tos: [], date, bulk: bool (List-Unsubscribe present) }.
 */
export function buildGraph(records) {
  const senders = new Map();
  const bump = (address, init) => {
    const entry = senders.get(address) ?? {
      address,
      incoming: 0,
      outgoing: 0,
      bulk: 0,
      lastSeen: null,
    };
    Object.assign(entry, init(entry));
    senders.set(address, entry);
    return entry;
  };
  for (const record of records) {
    const when = record.date ?? null;
    const touchLast = (entry) => (when !== null && (entry.lastSeen === null || when > entry.lastSeen) ? when : entry.lastSeen);
    if (record.direction === "in") {
      const entry = bump(record.from, (existing) => ({
        incoming: existing.incoming + 1,
        bulk: existing.bulk + (record.bulk ? 1 : 0),
        lastSeen: touchLast(existing),
      }));
      void entry;
    } else {
      for (const to of [...new Set(record.tos ?? [])].filter(Boolean)) {
        bump(to, (existing) => ({
          outgoing: existing.outgoing + 1,
          lastSeen: touchLast(existing),
        }));
      }
    }
  }
  for (const entry of senders.values()) {
    entry.tier = tierOf(entry);
    entry.score = scoreOf(entry);
  }
  return [...senders.values()].sort((a, b) => b.score - a.score);
}

export function tierOf(entry) {
  if (entry.incoming > 0 && entry.bulk / entry.incoming >= 0.5) return "bulk";
  const local = entry.address.split("@")[0] ?? "";
  const domain = entry.address.split("@")[1] ?? "";
  if (NOTIFICATION_LOCALS.test(local) || AUTOMATION_DOMAINS.test(domain)) return "bulk";
  if (entry.incoming >= 2 && entry.outgoing >= 2) return "inner";
  if (entry.outgoing >= 1 || entry.incoming >= 1) return "personal";
  return "cold";
}

function scoreOf(entry) {
  if (entry.tier === "bulk") return 0;
  const bidirectional = Math.min(entry.incoming, entry.outgoing);
  return bidirectional * 3 + entry.outgoing * 2 + entry.incoming;
}

const ACTION_KEYWORDS_ES = [
  "antes del", "por favor", "urgente", "confirmar", "confirmación", "adjunto",
  "necesito", "puedes", "puedes enviar", "te envío", "respuesta", "revisar", "plazo", "vence",
];
const ACTION_KEYWORDS_EN = [
  "by friday", "by monday", "before the", "please", "urgent", "confirm",
  "attached", "need you", "can you", "response", "review", "deadline", "due", "eod",
];

/**
 * The daily digest: unread inbox messages ranked by relationship tier and
 * deterministic action signals (dates + keywords + questions + attachments).
 * Bulk is suppressed unless it carries a security/transaction keyword.
 */
export function digestRows(messages, { limit = 8 } = {}) {
  const SECURITY_SENDERS = /(?:security|seguridad|account|no-?reply@(?:accounts|myaccount)\.|login|verify|billing|stripe|paypal)/iu;
  const rows = [];
  for (const message of messages) {
    const reasons = [];
    let score = 0;
    const tierWeight = { inner: 6, personal: 4, cold: 1, bulk: 0 }[message.senderTier ?? "cold"] ?? 0;
    score += tierWeight;
    if (tierWeight > 0) reasons.push(message.senderTier === "inner" ? "frequent two-way contact" : "known contact");

    const keywordHits = matchKeywords(message.text, ACTION_KEYWORDS_ES, ACTION_KEYWORDS_EN);
    score += keywordHits.length * 2;
    reasons.push(...keywordHits.slice(0, 3).map((hit) => `asks: "${hit}"`));

    const questionCount = (message.text.match(/\?/gu) ?? []).length;
    if (questionCount > 0 && message.senderTier !== "bulk") {
      score += 2;
      reasons.push(`${questionCount} question(s)`);
    }

    if (message.dates.length > 0) {
      score += 2;
      reasons.push(`date: ${message.dates[0].iso}`);
    }
    if (message.attachments.length > 0) {
      score += 1;
      reasons.push(`${message.attachments.length} attachment(s)`);
    }
    if (message.senderTier === "bulk" && SECURITY_SENDERS.test(message.from)) {
      // Above the bulk-suppression bar by itself: a sign-in alert is a
      // must-see even with zero content signals.
      score += 8;
      reasons.push("security/transactional sender");
    }
    if (message.senderTier === "bulk" && score < 6) continue;
    rows.push({
      messageId: message.messageId,
      threadId: message.threadId,
      from: message.from,
      subject: message.subject,
      date: message.date,
      score,
      reasons,
      snippet: message.text.slice(0, 180),
    });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}

function matchKeywords(text, esKeywords, enKeywords) {
  const lower = text.toLowerCase();
  const hits = [];
  for (const keyword of [...esKeywords, ...enKeywords]) {
    if (lower.includes(keyword)) hits.push(keyword);
  }
  return [...new Set(hits)];
}
