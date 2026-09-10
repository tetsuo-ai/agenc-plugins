/**
 * The paper-radar bridge: find emails that ARE documents — renewal
 * notices, policies, invoices, tickets — and emit their text in the exact
 * shape paper-radar's ingest expects, so the agent can feed the
 * administrative memory without copy-pasting. Also surfaces event-like
 * emails (bookings, appointments) as calendar candidates. Pure.
 */

const DOCUMENT_KEYWORDS_ES = [
  "renovación", "renovacion", "póliza", "poliza", "seguro", "factura", "recibo",
  "preaviso", "vencimiento", "cuota", "prima anual", "resumen de cuenta",
];
const DOCUMENT_KEYWORDS_EN = [
  "renewal", "policy", "invoice", "receipt", "statement", "notice period",
  "expiration", "premium due", "subscription renews",
];
const DOCUMENT_ATTACHMENT_TYPES = /(?:pdf)/iu;
const DOCUMENT_ATTACHMENT_NAMES = /(?:poliza|p[oó]liza|factura|invoice|receipt|recibo|policy|statement|contract|contrato|renewal)/iu;

const EVENT_KEYWORDS = /(?:vuelo|flight|reserva|booking|reservaci[oó]n|cita|appointment|check-?in|boarding|itinerario|itinerary|hotel|entrada|ticket)/iu;

/**
 * Classify analyzed messages into document candidates for paper-radar.
 * Output rows carry `ingestText` — pass it straight to paper-radar's
 * ingest_extract when that plugin is installed.
 */
export function documentRows(messages) {
  const rows = [];
  for (const message of messages) {
    const keywordHits = matchDocumentKeywords(message.subject + "\n" + message.text);
    const docAttachments = message.attachments.filter(
      (attachment) =>
        DOCUMENT_ATTACHMENT_TYPES.test(attachment.mimeType) ||
        DOCUMENT_ATTACHMENT_NAMES.test(attachment.filename),
    );
    const isDocument = keywordHits.length > 0 || docAttachments.length > 0;
    if (!isDocument) continue;
    const suggestedCategory = suggestCategory(keywordHits, docAttachments);
    rows.push({
      messageId: message.messageId,
      threadId: message.threadId,
      from: message.from,
      subject: message.subject,
      date: message.date,
      suggestedCategory,
      keywords: keywordHits.slice(0, 4),
      attachments: docAttachments.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        attachmentId: attachment.attachmentId,
      })),
      ingestText: buildIngestText(message, docAttachments),
    });
  }
  return rows;
}

/** Event-like emails with extractable dates → calendar (.ics) candidates. */
export function eventRows(messages, { extractDatesImpl }) {
  const rows = [];
  for (const message of messages) {
    if (!EVENT_KEYWORDS.test(message.subject)) continue;
    const dates = extractDatesImpl(`${message.subject}\n${message.text}`).slice(0, 3);
    if (dates.length === 0) continue;
    rows.push({
      messageId: message.messageId,
      subject: message.subject,
      from: message.from,
      date: message.date,
      dates: dates.map((entry) => ({ iso: entry.iso, evidence: entry.context })),
      snippet: message.text.slice(0, 140),
    });
  }
  return rows;
}

function matchDocumentKeywords(text) {
  const lower = text.toLowerCase();
  const hits = [];
  for (const keyword of [...DOCUMENT_KEYWORDS_ES, ...DOCUMENT_KEYWORDS_EN]) {
    if (lower.includes(keyword)) hits.push(keyword);
  }
  return [...new Set(hits)];
}

function suggestCategory(keywords, attachments) {
  const all = `${keywords.join(" ")} ${attachments.map((a) => a.filename).join(" ")}`.toLowerCase();
  if (/seguro|p[oó]liza|policy|insurance/.test(all)) return "insurance";
  if (/factura|invoice|receipt|recibo|statement/.test(all)) return "subscription";
  if (/renovaci|renewal|vencimiento|expiration/.test(all)) return "subscription";
  if (/vuelo|flight|boarding|hotel|ticket/.test(all)) return "other";
  return "other";
}

function buildIngestText(message, docAttachments) {
  const parts = [message.subject, "", message.text.slice(0, 4000)];
  for (const attachment of docAttachments) {
    parts.push("", `[ATTACHMENT: ${attachment.filename} (${attachment.mimeType}, ${attachment.sizeBytes} bytes) — download with vault_fetch and run pdftotext for full text]`);
  }
  return parts.join("\n");
}
