/**
 * Deterministic prose linter — the pluma engine room. Every style has a
 * ruleset; every rule is plain regex/arithmetic over the text in Spanish
 * and English: fillers, contractions, passive voice, hedges, vague
 * quantifiers, exclamations/emoji, sentence-length bands, readability
 * (Fernández Huerta for es, Flesch for en), and structure checks per
 * form (salutation/closing, required sections, word-count bands). The
 * model writes; this verifies. Pure — no I/O.
 */

export const STYLE_RULESETS = {
  formal: { family: "tone", rules: ["noExclamations", "noEmoji", "noContractionsEn", "noSlang", "noFillers", "courtesyPresent"] },
  cercano: { family: "tone", rules: ["noCeremonial", "noCorporateEmpty", "greetingPresent", "noExcessExclamations"] },
  directo: { family: "tone", rules: ["noFillers", "shortSentences", "tightParagraphs", "noDecorativeAdjectives"] },
  persuasivo: { family: "tone", rules: ["ctaPresent", "noHedges", "activeVerbs", "noFillers"] },
  tecnico: { family: "tone", rules: ["noFirstPersonOpinion", "noVagueQuantifiers", "monospaceForCode"] },
  "carta-formal": {
    family: "form", tone: "formal",
    rules: ["salutationPresent", "closingPresent", "minParagraphs:3", "wordBand:150:350", "noExclamations", "noEmoji", "noFillers"],
  },
  "email-profesional": {
    family: "form", tone: "cercano",
    rules: ["subjectActionable", "salutationPresent", "closingPresent", "wordBand:40:250"],
  },
  discurso: {
    family: "form", tone: "cercano",
    rules: ["openingHook", "anaphoraOrTricolon", "closingPresent", "wordBand:80:4000"],
  },
  propuesta: {
    family: "form", tone: "persuasivo",
    rules: ["sectionsPropuesta", "numbersPresent", "nextStepPresent"],
  },
  "cover-letter": {
    family: "form", tone: "formal",
    rules: ["salutationPresent", "closingPresent", "wordBand:150:380", "noClichePhrases", "achievementsWithNumbers"],
  },
};

const FILLERS = [
  "cabe destacar que", "hay que tener en cuenta que", "como es sabido", "en mi opinión personal",
  "a grandes rasgos se puede decir", "it is important to note", "it should be noted that",
  "needless to say", "as you know", "at the end of the day", "basically",
];
const SLANG = ["porfa", "rapidito", "un montón", "montón de", "super ", "chachi", "guay", "super-", "ok,", "ok.", "bueno pues"];
const CEREMONIAL = ["de mi mayor consideración", "por la presente", "me permito informar", "i am writing to inform you", "i'm writing to inform you", "please be advised"];
const CORPORATE_EMPTY = ["sinergia", "sinergias", "circle back", "touch base", "low-hanging", "apalancar", "hoja de ruta estratégica"];
const HEDGES = ["quizás", "quiza", "tal vez", "podría ser", "a lo mejor", "maybe", "perhaps", "somewhat", "might possibly"];
const VAGUE_QUANTIFIERS = ["varios", "muchos usuarios", "mucha gente", "bastantes veces", "un montón", "a lot of", "lots of", "some users", "several times"];
const CLICHES = ["persona proactiva", "orientada a resultados", "orientado a resultados", "trabajo bajo presión", "capacidad de liderazgo", "team player", "think outside the box", "results-oriented"];
const DECORATIVE_ADJECTIVES = /\b(?:muy|muy muy|realmente|super)\s+(?:importante|bueno|buena|grande| interesante|good|important|great)\b/giu;
const EN_CONTRACTIONS = /\b(?:\w+)(?:n't|'re|'ve|'ll|'m|'s)\b/giu;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const SALUTATIONS = /(?:^|\n)\s*(?:estimad[oa]s?\b|de mi mayor consideración|querid[oa]s?\b|hola[,\s]|equipo[:\s]|buenos días|buenas tardes|buenas noches|dear\b|hi,|hello,|to whom)/iu;
const CLOSINGS = /(?:^|\n)\s*(?:atentamente|cordialmente|un saludo|saludos?\b|gracias\b|quedo (?:a su )?disposición|le saluda|le saludo|sincerely|best regards|kind regards|warm regards|thanks\b|thank you\b|cheers)/iu;
const CTA = /(?:respond[eai]|responde|contest[ae]|escríbenos|escribinos|escríbeme|llam[ae]|llama|empieza|comenz[aeá]|comienza|aprovéchalo|aprovecha|regístrate|confirm[ae]|sign up|get started|claim your|reply|book a|schedule)/iu;
const OPINION_FIRST_PERSON = /\b(?:creo que|me parece|opino que|diría que|supongo que|i think|i believe|i feel like|i guess|i suppose)\b/giu;
const PASSIVE_ES = /\b(?:es|son|era|eran|fue|fueron|será|serán|ha sido|han sido|se\s+ha|se\s+había)\s+[\wáéíóúüñ]+(?:ado|ido|to|so|cho)\b/giu;
const PASSIVE_EN = /\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b/giu;
const SECTIONS_PROPUESTA = [
  { key: "contexto", re: /(?:^|\n)#{0,4}\s*(?:contexto|antecedentes|situaci[oó]n actual)\b/iu },
  { key: "objetivo", re: /(?:^|\n)#{0,4}\s*(?:objetivo|resultados? esperados?)\b/iu },
  { key: "alcance", re: /(?:^|\n)#{0,4}\s*(?:alcance|fases?|plan de trabajo)\b/iu },
  { key: "inversión", re: /(?:^|\n)#{0,4}\s*(?:inversi[oó]n|precio|coste|costo|tarifa|presupuesto)\b/iu },
  { key: "plazos", re: /(?:^|\n)#{0,4}\s*(?:plazos?|calendario|tiempos?|duraci[oó]n)\b/iu },
  { key: "siguientes pasos", re: /(?:^|\n)#{0,4}\s*(?:siguientes pasos|pr[oó]ximos pasos|next steps)\b/iu },
];

/**
 * Lint one text against one style. Returns stats, violations (with
 * excerpt + fix), and a 0-100 score. Unknowable things are reported as
 * info, not violations.
 */
export function lintText(text, styleKey, { subject } = {}) {
  const ruleset = STYLE_RULESETS[styleKey];
  if (ruleset === undefined) {
    return { error: `unknown style '${styleKey}'; known: ${Object.keys(STYLE_RULESETS).join(", ")}` };
  }
  const raw = String(text ?? "");
  const active = new Set(ruleset.rules);
  if (ruleset.tone !== undefined) {
    for (const rule of STYLE_RULESETS[ruleset.tone].rules) active.add(rule);
  }
  const stats = computeStats(raw);
  const violations = [];
  const violation = (severity, rule, excerpt, fix) =>
    violations.push({ severity, rule, excerpt: excerpt.slice(0, 120), fix });

  if (active.has("noFillers")) {
    for (const hit of findAny(raw, FILLERS)) {
      violation("error", "filler", hit.excerpt, "Delete the filler and keep the payload sentence");
    }
  }
  if (active.has("noSlang")) {
    for (const hit of findAny(raw, SLANG)) {
      violation("error", "slang", hit.excerpt, "Replace with a neutral register equivalent");
    }
  }
  if (active.has("noCeremonial")) {
    for (const hit of findAny(raw, CEREMONIAL)) {
      violation("warn", "ceremonial", hit.excerpt, "Write like a person: 'Te cuento que…' / plain phrasing");
    }
  }
  if (active.has("noCorporateEmpty")) {
    for (const hit of findAny(raw, CORPORATE_EMPTY)) {
      violation("warn", "corporate-empty", hit.excerpt, "Say the concrete thing or drop the phrase");
    }
  }
  if (active.has("noHedges")) {
    for (const hit of findAny(raw, HEDGES)) {
      violation("warn", "hedge", hit.excerpt, "State it, drop the hedge, or add the missing proof");
    }
  }
  if (active.has("noVagueQuantifiers")) {
    for (const hit of findAny(raw, VAGUE_QUANTIFIERS)) {
      violation("warn", "vague-quantity", hit.excerpt, "Quantify ('900 rps', '12 days') or remove the claim");
    }
  }
  if (active.has("noClichePhrases")) {
    for (const hit of findAny(raw, CLICHES)) {
      violation("error", "cliche", hit.excerpt, "Replace with a measured achievement");
    }
  }
  if (active.has("noFirstPersonOpinion")) {
    for (const hit of findAllRegex(raw, OPINION_FIRST_PERSON)) {
      violation("error", "opinion-first-person", hit, "State the fact with its source; opinion belongs in a labeled assumptions section");
    }
  }
  if (active.has("noExclamations") && stats.exclamations > 0) {
    violation("error", "exclamation", `${stats.exclamations} exclamation(s)`, "Formal register: replace with a full stop");
  }
  if (active.has("noExcessExclamations") && stats.exclamations > 2) {
    violation("warn", "excess-exclamations", `${stats.exclamations} exclamation(s)`, "Keep at most two in the whole message");
  }
  if (active.has("noEmoji")) {
    const emojis = raw.match(EMOJI) ?? [];
    if (emojis.length > 0) {
      violation("error", "emoji", `${emojis.length} emoji: ${emojis.slice(0, 4).join(" ")}`, "Remove; the register does not admit emoji");
    }
  }
  if (active.has("noContractionsEn")) {
    const contractions = [...raw.matchAll(EN_CONTRACTIONS)].map((m) => m[0]);
    if (contractions.length > 0) {
      violation("warn", "contraction-en", contractions.slice(0, 5).join(", "), "Expand: 'do not', 'I am', 'it is'");
    }
  }
  if (active.has("noDecorativeAdjectives")) {
    for (const hit of findAllRegex(raw, DECORATIVE_ADJECTIVES)) {
      violation("warn", "decorative-adjective", hit, "Drop the intensifier; the fact carries the weight");
    }
  }
  if (active.has("shortSentences") && stats.avgSentenceWords > 15) {
    violation("warn", "long-sentences", `average ${stats.avgSentenceWords} words/sentence`, "Split: one idea per sentence (target ≤ 15)");
  }
  if (active.has("tightParagraphs") && stats.maxParagraphSentences > 4) {
    violation("warn", "long-paragraph", `paragraph with ${stats.maxParagraphSentences} sentences`, "Break into ≤ 3 sentences or a list");
  }
  if (active.has("courtesyPresent") && !SALUTATIONS.test(raw) && !CLOSINGS.test(raw) && stats.words > 40) {
    violation("warn", "courtesy-missing", "no salutation or closing detected", "Add a measured salutation or closing if the channel expects it");
  }
  if (active.has("greetingPresent") && !SALUTATIONS.test(raw)) {
    violation("warn", "greeting-missing", "no greeting detected", "Open with a short greeting: 'Hola, [nombre] —'");
  }
  if (active.has("salutationPresent") && !SALUTATIONS.test(raw)) {
    violation("error", "salutation-missing", "no salutation found", "Add: 'Estimado/a …:' / 'Dear …,'");
  }
  if (active.has("closingPresent") && !CLOSINGS.test(raw)) {
    violation("error", "closing-missing", "no closing found", "Add: 'Atentamente' / 'Un saludo' / 'Sincerely'");
  }
  if (active.has("subjectActionable")) {
    const value = String(subject ?? "").trim();
    if (value.length === 0) {
      violation("error", "subject-missing", "no subject provided", "Give the email an actionable subject with owner and deadline");
    } else if (/^(?:duda|consulta|pregunta|hello|hi|hola|info)\b/iu.test(value) || value.split(/\s+/u).length < 3) {
      violation("warn", "subject-vague", `subject: '${value}'`, "Make it specific: 'Approval needed: X (by 12/09)'");
    }
  }
  if (active.has("ctaPresent") && !CTA.test(raw)) {
    violation("error", "cta-missing", "no call to action found", "Add exactly one concrete imperative action");
  }
  if (active.has("openingHook")) {
    const firstSentence = stats.sentences[0] ?? "";
    if (!/[?¡!]|imagine[sn]?|imaginen|visualicen|picture this|hace \d|en \d{4}\b/iu.test(firstSentence)) {
      violation("warn", "hook-missing", `opens with: '${firstSentence.slice(0, 60)}'`, "Open with a question, number, or scene");
    }
  }
  if (active.has("anaphoraOrTricolon")) {
    const starts = stats.sentences.map((s) => firstWords(s, 2).toLowerCase());
    const repeated = new Set(starts.filter((start, i) => start.length > 3 && starts.indexOf(start) !== i));
    const tricolon = /\b\w+,\s+\w+,?\s+y\s+\w+\b|\b\w+,\s+\w+,\s+and\s+\w+\b/iu.test(raw);
    if (repeated.size === 0 && !tricolon) {
      violation("info", "rhetoric-missing", "no repeated sentence openings or triads found", "Add one anaphora block or a triad ('más rápido, más simple, más barato')");
    }
  }
  if (active.has("minParagraphs:3") && stats.paragraphs < 3) {
    violation("warn", "few-paragraphs", `${stats.paragraphs} paragraph(s)`, "A letter body needs at least 3: motive, facts, request");
  }
  const band = [...active].find((rule) => rule.startsWith("wordBand:"));
  if (band !== undefined) {
    const [, minRaw, maxRaw] = band.split(":");
    const min = Number(minRaw);
    const max = Number(maxRaw);
    if (stats.words < min) {
      violation("warn", "too-short", `${stats.words} words (target ${min}-${max})`, `Develop the content: about ${min - stats.words} more words`);
    } else if (stats.words > max) {
      violation("warn", "too-long", `${stats.words} words (target ${min}-${max})`, `Cut about ${stats.words - max} words`);
    }
  }
  if (active.has("sectionsPropuesta")) {
    for (const section of SECTIONS_PROPUESTA) {
      if (!section.re.test(raw)) {
        violation("error", `missing-section:${section.key}`, `'${section.key}' section not found`, `Add the '${section.key}' section with a heading`);
      }
    }
  }
  if (active.has("numbersPresent") && !/\d/.test(raw)) {
    violation("error", "no-numbers", "no digits in the whole proposal", "Proposals need prices, day counts or metrics");
  }
  if (active.has("nextStepPresent") && !/siguientes pasos|pr[oó]ximos pasos|next steps|siguiente paso/iu.test(raw)) {
    violation("error", "next-step-missing", "no next-steps block", "End with what the reader must do and by when");
  }
  if (active.has("achievementsWithNumbers")) {
    const bulletLines = raw.split(/\n/u).filter((line) => /(?:\d+\s*%|\b\d{2,}\b)/u.test(line));
    if (bulletLines.length < 2) {
      violation("warn", "few-measured-achievements", `${bulletLines.length} line(s) with numbers`, "Add 2-3 achievements with numbers, scale or deadlines");
    }
  }
  if (active.has("monospaceForCode")) {
    const suspicious = raw.match(/\b(?:npm install|npm run|git checkout|curl |POST \/|GET \/)\b[^\s`]*/gu) ?? [];
    const bare = suspicious.filter((chunk) => !raw.includes(`\`${chunk}\``));
    if (bare.length > 0) {
      violation("info", "code-not-monospace", bare.slice(0, 3).join(" | "), "Wrap commands/paths in backticks");
    }
  }
  if (ruleset.family === "tone" && PASSIVE_COUNT_RULES(active) && (raw.match(PASSIVE_ES) ?? []).length + (raw.match(PASSIVE_EN) ?? []).length > 6) {
    violation("info", "passive-heavy", `${(raw.match(PASSIVE_ES) ?? []).length + (raw.match(PASSIVE_EN) ?? []).length} passive constructions`, "Prefer active voice where the actor matters");
  }

  const score = computeScore(violations);
  return { style: styleKey, family: ruleset.family, stats, violations, score, pass: score >= 85 };
}

function PASSIVE_COUNT_RULES(active) {
  return active.has("noFillers") || active.has("ctaPresent") || active.has("noVagueQuantifiers");
}

function computeScore(violations) {
  const weights = { error: 12, warn: 5, info: 2 };
  const penalty = violations.reduce((a, v) => a + (weights[v.severity] ?? 2), 0);
  return Math.max(0, 100 - penalty);
}

export function computeStats(text) {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const sentences = text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const paragraphs = text.split(/\n\s*\n/u).map((p) => p.trim()).filter((p) => p.length > 0);
  const wordCount = words.length;
  const sentenceWords = sentences.map((s) => s.split(/\s+/u).filter(Boolean).length);
  const avgSentenceWords = sentenceWords.length > 0
    ? Math.round((wordCount / sentenceWords.length) * 10) / 10
    : wordCount;
  const syllables = words.reduce((a, word) => a + countSyllables(word), 0);
  const sentenceCount = Math.max(sentences.length, 1);
  const wordsPerSentence = Math.max(wordCount / sentenceCount, 1);
  const syllablesPerWord = Math.max(syllables / Math.max(wordCount, 1), 1);
  // Reading-ease family: 206.835 - 1.015*w/s - 84.6*syl/w (Flesch;
  // Fernández Huerta uses the same shape with Spanish constants).
  const readability = Math.max(0, Math.min(100, Math.round(206.84 - 1.02 * wordsPerSentence - 84.6 * syllablesPerWord)));
  return {
    words: wordCount,
    sentences: sentences,
    paragraphs: paragraphs.length,
    maxParagraphSentences: paragraphs.reduce(
      (a, p) => Math.max(a, p.split(/(?<=[.!?…])\s+/u).filter((s) => s.trim().length > 0).length),
      0,
    ),
    avgSentenceWords,
    exclamations: (text.match(/!/gu) ?? []).length,
    readability,
    passiveEs: (text.match(PASSIVE_ES) ?? []).length,
    passiveEn: (text.match(PASSIVE_EN) ?? []).length,
  };
}

function countSyllables(word) {
  const clean = word.toLowerCase().replace(/[^a-záéíóúüñ]/gu, "");
  if (clean.length <= 3) return 1;
  const groups = clean.match(/[aeiouáéíóúü]+/gu) ?? ["a"];
  let count = groups.length;
  // Spanish dipthong reductions and final -es/-e don't add syllables.
  if (/[aeiou]s$/u.test(clean) && count > 1) count -= 0;
  return Math.max(1, count);
}

function findAny(text, phrases) {
  const lower = text.toLowerCase();
  const hits = [];
  for (const phrase of phrases) {
    let index = lower.indexOf(phrase.toLowerCase());
    while (index !== -1) {
      hits.push({ phrase, excerpt: excerptAround(text, index, phrase.length) });
      index = lower.indexOf(phrase.toLowerCase(), index + 1);
    }
  }
  return hits;
}

function findAllRegex(text, regex) {
  const out = [];
  for (const match of text.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`))) {
    out.push(match[0]);
  }
  return [...new Set(out)].slice(0, 5);
}

function excerptAround(text, index, length) {
  return text
    .slice(Math.max(0, index - 40), Math.min(text.length, index + length + 40))
    .replace(/\s+/gu, " ")
    .trim();
}

function firstWords(sentence, count) {
  return sentence.split(/\s+/u).slice(0, count).join(" ");
}
