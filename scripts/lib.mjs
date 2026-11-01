// Pure helpers for the sync script. No network and no secrets in this file.

/** "GEM MT 10" -> 10, "NM-MT+ 8.5" -> 8.5, "MINT 9 (OC)" -> 9, "Authentic" -> null */
export function gradeNumber(cardGrade) {
  const match = String(cardGrade ?? '').match(/(\d+(?:\.\d+)?)(?!.*\d)/);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 10 ? n : null;
}

/** PriceCharting reuses its video-game field names for card grades. Prices are in pennies. */
export function priceFieldForGrade(grade) {
  if (grade === 10) return 'manual-only-price';
  if (grade === 9.5) return 'box-only-price';
  if (grade === 9) return 'graded-price';
  if (grade === 8 || grade === 8.5) return 'new-price';
  if (grade === 7 || grade === 7.5) return 'cib-price';
  return null;
}

/** Splits a comma or newline separated secret into unique, safe identifiers. */
export function parseIdList(raw) {
  const ids = String(raw ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(ids.filter((id) => /^[A-Za-z0-9-]{1,40}$/.test(id)))];
}

/** Published in place of the real number so the public site cannot reveal it. */
export function maskId(id) {
  return `••••${String(id).slice(-4)}`;
}

export function httpsUrlOrNull(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Whitelist: only fields named here can ever reach the public JSON. */
export function pickCert(raw) {
  return {
    cert: String(raw.CertNumber ?? ''),
    specId: raw.SpecID ?? null,
    year: raw.Year ?? null,
    brand: raw.Brand ?? null,
    category: raw.Category ?? null,
    cardNumber: raw.CardNumber ?? null,
    subject: raw.Subject ?? null,
    variety: raw.Variety ?? null,
    gradeLabel: raw.CardGrade ?? raw.GradeDescription ?? null,
    grade: gradeNumber(raw.CardGrade),
    population: raw.TotalPopulation ?? null,
    populationHigher: raw.PopulationHigher ?? null,
  };
}

/** The images endpoint has no published schema, so accept the known array shape only. */
export function pickImages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const find = (isFront) =>
    httpsUrlOrNull(list.find((img) => Boolean(img?.IsFrontImage) === isFront)?.ImageURL);
  return { front: find(true), back: find(false) };
}

/** Deliberately drops shipTrackingNumber, shipCarrier and the real order number. */
export function pickOrder(raw, id, kind) {
  const steps = Array.isArray(raw.orderProgressSteps) ? raw.orderProgressSteps : [];
  return {
    id: maskId(id),
    kind,
    problem: Boolean(raw.problemOrder),
    accountingHold: Boolean(raw.accountingHold),
    gradesReady: Boolean(raw.gradesReady),
    shipped: Boolean(raw.shipped),
    steps: [...steps]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((s) => ({ name: String(s.step ?? ''), done: Boolean(s.completed) })),
  };
}

/**
 * Spends the PSA daily allowance: new certs first (2 calls each), then certs
 * missing images (1 call), then the stalest refreshes (1 call).
 */
export function planCertWork(certs, cache, budget, now, staleDays = 7) {
  const staleMs = staleDays * 86_400_000;
  const known = certs.filter((c) => cache[c]);
  const queue = [
    ...certs.filter((c) => !cache[c]).map((cert) => ({ cert, cost: 2, details: true, images: true })),
    ...known
      .filter((c) => !cache[c].images?.front)
      .map((cert) => ({ cert, cost: 1, details: false, images: true })),
    ...known
      .filter((c) => now - Date.parse(cache[c].fetchedAt ?? 0) > staleMs)
      .sort((a, b) => Date.parse(cache[a].fetchedAt ?? 0) - Date.parse(cache[b].fetchedAt ?? 0))
      .map((cert) => ({ cert, cost: 1, details: true, images: false })),
  ];
  const plan = [];
  let left = budget;
  for (const job of queue) {
    if (job.cost > left) continue;
    plan.push(job);
    left -= job.cost;
  }
  return plan;
}
