/**
 * Quill contract tests: the deterministic prose linter against Spanish
 * and English fixtures per style, plus the MCP server as a real child
 * process (catalog, lint round-trips, error semantics). Fully offline.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { STYLE_RULESETS, computeStats, lintText } from "../plugins/pluma/server/lint.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "pluma", "server", "main.mjs");

const rules = (result) => result.violations.map((v) => v.rule);

test("lint: formal register catches exclamation, emoji, slang and fillers", () => {
  const bad = lintText(
    "¡Hola! Te paso el informe rapidito, creo que está bastante bien 😊. Cabe destacar que lo terminé ok.",
    "formal",
  );
  const found = rules(bad);
  assert.ok(found.includes("exclamation"));
  assert.ok(found.includes("emoji"));
  assert.ok(found.includes("slang"));
  assert.ok(found.includes("filler"));
  assert.ok(bad.score < 85, `score ${bad.score} should fail`);

  const good = lintText(
    "Le hago llegar el informe solicitado. El documento incluye la revisión completa de los anexos. Quedo a su disposición para cualquier ampliación que estime oportuna.",
    "formal",
  );
  assert.equal(good.violations.filter((v) => v.severity === "error").length, 0, JSON.stringify(good.violations));
  assert.ok(good.pass, `good formal should pass (got ${good.score}: ${JSON.stringify(good.violations)})`);
});

test("lint: concise enforces sentence economy and kills fillers", () => {
  const verbose = "Básicamente, cabe destacar que, tras un análisis muy detallado y teniendo en cuenta diversos factores de naturaleza operativa, consideramos que la migración se podría retrasar.";
  const result = lintText(verbose, "directo");
  const found = rules(result);
  assert.ok(found.includes("filler"));
  assert.ok(found.includes("long-sentences") || found.includes("decorative-adjective"), `economy caught (${found})`);
  assert.ok(result.score < 85);

  const tight = "Retrasamos una semana.\nFalta el dato de carga.\nVuelve el viernes con todo listo para revisar.";
  const ok = lintText(tight, "directo");
  assert.equal(ok.violations.filter((v) => v.severity === "error").length, 0, JSON.stringify(ok.violations));
});

test("lint: persuasive demands a CTA and punishes hedges; technical punishes opinion and vague quantity", () => {
  const noCta = lintText("Nuestra plataforma automatiza recordatorios de pago. Reduce la morosidad.", "persuasivo");
  assert.ok(rules(noCta).includes("cta-missing"));

  const withCta = lintText(
    "Tus facturas se cobran 12 días antes con recordatorios automatizados. Prueba conocida: 40% menos retrasos. Empieza el lunes con tu plantilla actual.",
    "persuasivo",
  );
  assert.ok(withCta.pass, `score ${withCta.score}: ${JSON.stringify(withCta.violations)}`);

  const tech = lintText("Creo que el servicio falla cuando hay mucha carga y muchos usuarios a la vez.", "tecnico");
  const found = rules(tech);
  assert.ok(found.includes("opinion-first-person"));
  assert.ok(found.includes("vague-quantity"));

  const techOk = lintText("Con más de 900 rps sostenidos, el p99 excede el timeout de 5 s en los workers de cola. Medido el 2026-08-30 en el panel `colas`.", "tecnico");
  assert.equal(techOk.violations.filter((v) => v.severity === "error").length, 0, JSON.stringify(techOk.violations));
});

test("lint: formal-letter enforces protocol structure and length band", () => {
  const bad = lintText("Les escribo porque quiero cancelar el seguro. Gracias.", "carta-formal");
  const found = rules(bad);
  assert.ok(found.includes("salutation-missing"));
  assert.ok(found.includes("closing-missing"));
  assert.ok(found.includes("too-short") || found.includes("few-paragraphs"));

  const letter = [
    "Madrid, 7 de septiembre de 2026",
    "Departamento de Atención al Cliente ; Seguros Ejemplo, S.A.",
    "Asunto: solicitud de no renovación de póliza 123-456",
    "Estimados señores:",
    "Les escribo para comunicar mi decisión de no renovar la póliza 123-456 a su vencimiento del 30 de noviembre de 2026.",
    "Solicito la confirmación escrita de esta baja y del cese de cargos asociados, conforme a las condiciones contratadas.",
    "Atentamente,",
    "Paula García ; titular",
  ].join("\n\n");
  const good = lintText(letter, "carta-formal");
  assert.equal(good.violations.filter((v) => v.severity === "error").length, 0, JSON.stringify(good.violations));
  assert.ok(good.score >= 60, `score ${good.score}`);
});

test("lint: proposal requires the six sections, numbers and next steps", () => {
  const bad = lintText("Os proponemos modernizar vuestro proceso de facturación con automatizaciones.", "propuesta");
  const found = rules(bad);
  for (const section of ["context", "objective", "scope", "investment", "timeline"]) {
    assert.ok(found.includes(`missing-section:${section}`), `${section} missing (${found})`);
  }
  assert.ok(found.includes("no-numbers"));
  assert.ok(found.includes("next-step-missing"));

  const proposal = [
    "## Contexto",
    "Sus facturas se cobran con 40 días de media; dos personas dedican 6 h/semana a recordarlas.",
    "## Objetivo",
    "Reducir el tiempo de cobro a 28 días antes del 31 de diciembre de 2026.",
    "## Alcance",
    "Fase 1: plantilla y recordatorios (2 semanas). Fase 2: integración con su ERP (3 semanas).",
    "## Inversión",
    "Fase 1: 1.800 €. Fase 2: 2.600 €. Vigencia 30 días.",
    "## Plazos",
    "Inicio el 15 de septiembre de 2026; fin estimado el 30 de octubre de 2026.",
    "## Siguientes pasos",
    "Responda este correo con la fase a aprobar antes del 12 de septiembre.",
  ].join("\n\n");
  const good = lintText(proposal, "propuesta");
  assert.equal(good.violations.filter((v) => v.severity === "error").length, 0, JSON.stringify(good.violations));
  assert.ok(good.pass, `score ${good.score}: ${JSON.stringify(good.violations)}`);
});

test("lint: professional-email checks the subject; cover-letter kills clichés and wants numbers", () => {
  const vagueSubject = lintText("Hola, Ana:\nAdjunto el presupuesto para revisión.\nUn saludo", "email-profesional", { subject: "Duda" });
  assert.ok(rules(vagueSubject).includes("subject-vague"));
  const noSubject = lintText("Hola, Ana:\nAdjunto el presupuesto para revisión.\nUn saludo", "email-profesional");
  assert.ok(rules(noSubject).includes("subject-missing"));
  const ok = lintText("Hola, Ana:\nAdjunto el presupuesto Q4 para tu aprobación; vence el 12/09.\nGracias", "email-profesional", { subject: "Aprobación pendiente: presupuesto Q4 (vence 12/09)" });
  assert.equal(ok.violations.filter((v) => v.severity === "error").length, 0, JSON.stringify(ok.violations));

  const cliche = lintText(
    "Estimado equipo:\nSoy una persona proactiva y orientada a resultados con capacidad de liderazgo.\nAtentamente,\nPaula",
    "cover-letter",
  );
  const found = rules(cliche);
  assert.ok(found.includes("cliche"));
  assert.ok(found.includes("few-measured-achievements"));
});

test("lint: english drafts: contractions and fillers in formal; ceremonial flagged in warm", () => {
  const bad = lintText("I'm writing to inform you that we don't think the rollout maybe worked. It should be noted that errors basically happened.", "formal");
  const found = rules(bad);
  assert.ok(found.includes("contraction-en"));
  assert.ok(found.includes("filler"), `fillers caught (${found})`);
  // Stiff ceremony belongs to the warm rulebook, not the formal one.
  const stiff = lintText("I am writing to inform you that the rollout proceeded as planned. Best regards", "cercano");
  assert.ok(rules(stiff).includes("ceremonial"));
  const good = lintText(
    "Dear Ms. Chen,\nWe completed the migration ahead of schedule on September 3.\nAll 14 services pass their health checks.\nBest regards,\nPaul",
    "formal",
  );
  assert.equal(good.violations.filter((v) => v.severity === "error").length, 0, JSON.stringify(good.violations));
});

test("stats: syllables, readability and passive counting behave", () => {
  const stats = computeStats("El sistema se reinicia cada 24 horas. Fue diseñado para tolerar fallos parciales y fue desplegado sin incidencias.");
  assert.equal(stats.paragraphs, 1);
  assert.equal(stats.passiveEs >= 2, true, `passive es counted (${stats.passiveEs})`);
  assert.ok(stats.readability > 0 && stats.readability <= 100);
  const en = computeStats("The service was restarted and the queue was drained quickly.");
  assert.ok(en.passiveEn >= 2);
});

test("lint: unknown style is an actionable error, forms carry their tone", () => {
  const bad = lintText("texto", "no-existe");
  assert.match(bad.error, /unknown style 'no-existe'/u);
  // formal-letter inherits formal's exclamation rule via tone composition.
  const shouty = lintText("Estimados señores:\n¡Tengo una urgencia!\nAtentamente,\nPaula", "carta-formal");
  assert.ok(rules(shouty).includes("exclamation"), "form carries its tone");
});

test("mcp server: catalog and lint round-trips: as a real child process", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "pluma-mcp-"));
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, AGENC_PLUGIN_DATA: dataDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  const responses = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      const message = JSON.parse(line);
      responses.push(message);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  const tool = (name, args) =>
    call("tools/call", { name, arguments: args }).then(
      (r) => r.result?.structuredContent ?? r.result?.content?.[0]?.text ?? r.error,
    );
  try {
    const init = await call("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "t", version: "0" } });
    assert.equal(init.result.serverInfo.name, "pluma");
    assert.equal(init.result.serverInfo.title, "Quill");
    const catalog = await call("tools/list");
    assert.deepEqual(catalog.result.tools.map((t) => t.name).sort(), ["style_lint", "styles_list"]);

    const lintSchema = catalog.result.tools.find((entry) => entry.name === "style_lint").inputSchema;
    assert.ok(lintSchema.properties.style.enum.includes("concise"));
    assert.ok(lintSchema.properties.style.enum.includes("directo"), "legacy requests remain schema-valid");

    const list = await tool("styles_list", {});
    assert.equal(list.styles.length, Object.keys(STYLE_RULESETS).length);
    const letterStyle = list.styles.find((s) => s.key === "formal-letter");
    assert.equal(letterStyle.family, "form");
    assert.equal(letterStyle.outputStyleName, "carta-formal");
    assert.equal(letterStyle.carriesTone, "formal");
    assert.ok(letterStyle.lintRules.includes("salutationPresent"));
    assert.ok(letterStyle.description.length > 20, "descriptions read from the style files");

    const linted = await tool("style_lint", {
      text: "¡Hola! Te paso el informe rapidito 😊, cabe destacar que está bien.",
      style: "formal",
    });
    assert.ok(linted.violations.length >= 4);
    assert.ok(linted.score < 85);
    const clean = await tool("style_lint", {
      text: "Le hago llegar el informe solicitado con la revisión completa. Quedo a su disposición para cualquier ampliación.",
      style: "formal",
    });
    assert.ok(clean.pass, `clean passes (${clean.score}: ${JSON.stringify(clean.violations)})`);

    const unknown = await tool("style_lint", { text: "x", style: "zzz" });
    assert.match(unknown, /unknown style/u);
    const rpc = await call("tools/call", { name: "nope", arguments: {} });
    assert.equal(rpc.error.code, -32602);

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(responses.every((m) => m.id !== undefined), "no response to notifications");
  } finally {
    child.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  }
});
