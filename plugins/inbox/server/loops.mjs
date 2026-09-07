/**
 * The social commitments layer: waiting-on threads (you asked, they went
 * silent), reply debt (humans awaiting YOUR answer), and commitment
 * candidates (promises with dates, detected deterministically in es/en —
 * the agent confirms and words them). Pure functions over thread records.
 */

const QUESTION_RE = /(?:\?|(^|\s)(?:podr[ií]as|puedes|pod[eé]s enviar|me pasas|me mandas|env[ií]ame|could you|can you|would you|please send|when can)\b)/iu;

const PROMISE_PATTERNS_ES = [
  /\b(?:te\s+)?(?:env[ií]o|mando|le\s+mando|te\s+lo\s+env[ií]o|se\s+lo\s+env[ií]o|hago|preparo|reviso|respondo|te\s+respondo|lo\s+termino)\b[^.!?]{0,80}/giu,
  /\b(?:enviar[eé]|mandar[eé]|har[eé]|preparar[eé]|revisar[eé]|responder[eé])\b[^.!?]{0,80}/giu,
];
const PROMISE_PATTERNS_EN = [
  /\bI(?:'ll|\s+will)\s+(?:send|share|get|finish|review|reply|respond|deliver|call)\b[^.!?]{0,80}/giu,
];

/**
 * Threads where the last message is MINE and asks something. Returns rows
 * with aging so the agent can surface "you asked 8 days ago, no reply".
 */
export function waitingOnRows(threads, { now = new Date(), minDays = 0, excludeTiers = new Set(["bulk"]) } = {}) {
  const rows = [];
  for (const thread of threads) {
    if (thread.lastDirection !== "out") continue;
    if (excludeTiers.has(thread.lastSenderTier ?? "personal")) continue;
    if (!QUESTION_RE.test(thread.lastText)) continue;
    const days = daysSince(thread.lastDate, now);
    if (days < minDays) continue;
    rows.push({
      threadId: thread.threadId,
      contact: thread.lastContact,
      subject: thread.subject,
      askedOn: thread.lastDate,
      daysWaiting: days,
      snippet: thread.lastText.slice(0, 160),
    });
  }
  return rows.sort((a, b) => b.daysWaiting - a.daysWaiting);
}

/**
 * Reply debt: inbound human-tier messages that never got an answer from
 * you and are not part of a thread where you spoke last.
 */
export function replyDebtRows(messages, { now = new Date(), maxDays = 30 } = {}) {
  const rows = [];
  for (const message of messages) {
    if (message.direction !== "in") continue;
    if (message.senderTier !== "inner" && message.senderTier !== "personal") continue;
    if (message.answered) continue;
    if (QUESTION_RE.test(message.text) === false && message.text.trim().length < 20) continue;
    const days = daysSince(message.date, now);
    if (days > maxDays) continue;
    rows.push({
      messageId: message.messageId,
      from: message.from,
      subject: message.subject,
      date: message.date,
      daysWaiting: days,
      snippet: message.text.slice(0, 160),
    });
  }
  return rows.sort((a, b) => b.daysWaiting - a.daysWaiting);
}

/**
 * Deterministic commitment candidates: my outbound sentences that pair a
 * first-person promise verb with a date (paper-radar's engine). The agent
 * reads the evidence and words the commitment with the user.
 */
export function commitmentCandidates(messages, { extractDatesImpl } = {}) {
  const extract = extractDatesImpl;
  const out = [];
  for (const message of messages) {
    if (message.direction !== "out") continue;
    const text = message.text;
    const sentences = splitSentences(text);
    for (const sentence of sentences) {
      const isPromise =
        PROMISE_PATTERNS_ES.some((pattern) => pattern.test(sentence)) ||
        PROMISE_PATTERNS_EN.some((pattern) => pattern.test(sentence));
      // Reset lastIndex on global regexes before/after test.
      for (const pattern of [...PROMISE_PATTERNS_ES, ...PROMISE_PATTERNS_EN]) pattern.lastIndex = 0;
      if (!isPromise) continue;
      const dates = extract(sentence);
      const promiseMatch =
        sentence.match(PROMISE_PATTERNS_ES[0])?.[0] ??
        sentence.match(PROMISE_PATTERNS_EN[0])?.[0] ??
        sentence.slice(0, 80);
      out.push({
        messageId: message.messageId,
        threadId: message.threadId,
        to: message.to,
        subject: message.subject,
        date: message.date,
        promise: promiseMatch.trim().slice(0, 120),
        dueDates: dates.map((entry) => entry.iso),
        evidence: sentence.slice(0, 200),
      });
    }
  }
  return out;
}

function splitSentences(text) {
  return text
    .replace(/\r?\n/gu, " ")
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 10 && sentence.length < 400);
}

function daysSince(dateIso, now) {
  const then = Date.parse(dateIso);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.round((now.getTime() - then) / (24 * 3600 * 1000)));
}
