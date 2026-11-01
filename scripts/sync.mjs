// Runs only inside GitHub Actions (or locally with env vars). Reads secrets from
// the environment and writes site/data/portfolio.json, which contains no secrets.
// Never log a request URL: the PriceCharting token is part of its query string.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  httpsUrlOrNull, maskId, parseIdList, pickCert, pickImages, pickOrder,
  planCertWork, priceFieldForGrade,
} from './lib.mjs';

const PSA_API = 'https://api.psacard.com/publicapi';
const PRICECHARTING_API = 'https://www.pricecharting.com/api/product';
const OUTPUT = new URL('../site/data/portfolio.json', import.meta.url);
const COLLECTION = new URL('../collection.json', import.meta.url);

const {
  PSA_API_TOKEN, PRICECHARTING_TOKEN, PSA_ORDER_NUMBERS, PSA_SUBMISSION_NUMBERS,
  PREVIOUS_DATA_URL,
} = process.env;
const budget = Number(process.env.PSA_DAILY_CALL_BUDGET) || 80;

const warnings = [];
const warn = (message) => {
  warnings.push(message);
  console.warn(`::warning::${message}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class PsaStop extends Error {}
let psaCalls = 0;

async function psa(path) {
  psaCalls += 1;
  const res = await fetch(`${PSA_API}${path}`, {
    headers: { Authorization: `bearer ${PSA_API_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 403) throw new PsaStop('PSA ปฏิเสธ token (ตรวจ secret PSA_API_TOKEN)');
  if (res.status === 429) throw new PsaStop('ใช้โควตา PSA API ของวันนี้หมดแล้ว จะดึงต่อในรอบถัดไป');
  if (!res.ok) throw new Error(`PSA HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function loadPrevious() {
  const url = httpsUrlOrNull(PREVIOUS_DATA_URL);
  if (!url) return { cards: [], orders: [] };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.json() : { cards: [], orders: [] };
  } catch {
    return { cards: [], orders: [] };
  }
}

async function syncCerts(entries, previous, callsForCerts) {
  const cache = Object.fromEntries((previous.cards ?? []).map((c) => [c.cert, c]));
  const certs = entries.map((e) => e.cert);
  const plan = planCertWork(certs, cache, callsForCerts, Date.now());
  const skippedNew = certs.filter((c) => !cache[c] && !plan.some((job) => job.cert === c));
  if (skippedNew.length) warn(`ยังดึงการ์ดใหม่ไม่ครบ เหลือ ${skippedNew.length} ใบ จะดึงต่อในรอบถัดไป`);

  for (const job of plan) {
    try {
      const next = { ...cache[job.cert] };
      if (job.details) {
        const body = await psa(`/cert/GetByCertNumber/${encodeURIComponent(job.cert)}`);
        if (!body?.PSACert) {
          warn(`ไม่พบ cert ${job.cert} ในระบบ PSA`);
          continue;
        }
        Object.assign(next, pickCert(body.PSACert), { cert: job.cert, fetchedAt: new Date().toISOString() });
      }
      if (job.images) {
        next.images = pickImages(await psa(`/cert/GetImagesByCertNumber/${encodeURIComponent(job.cert)}`));
      }
      cache[job.cert] = next;
    } catch (error) {
      if (error instanceof PsaStop) {
        warn(error.message);
        break;
      }
      warn(`ดึง cert ${job.cert} ไม่สำเร็จ: ${error.message}`);
    }
  }
  return cache;
}

async function syncOrders(ids, previous) {
  const known = Object.fromEntries((previous.orders ?? []).map((o) => [o.id, o]));
  const orders = [];
  for (const { id, kind, path } of ids) {
    const cached = known[maskId(id)];
    // A shipped order never changes again, so it does not spend quota.
    if (cached?.shipped) {
      orders.push(cached);
      continue;
    }
    try {
      const body = await psa(`/order/${path}/${encodeURIComponent(id)}`);
      if (body) orders.push({ ...pickOrder(body, id, kind), fetchedAt: new Date().toISOString() });
      else warn(`ไม่พบรายการส่งเกรด ${maskId(id)}`);
    } catch (error) {
      if (cached) orders.push(cached);
      warn(error instanceof PsaStop ? error.message : `ดึงสถานะ ${maskId(id)} ไม่สำเร็จ: ${error.message}`);
      if (error instanceof PsaStop) break;
    }
  }
  return orders;
}

async function marketValue(entry, card) {
  const field = priceFieldForGrade(card?.grade);
  if (PRICECHARTING_TOKEN && entry.pricechartingId && field) {
    try {
      const query = new URLSearchParams({ t: PRICECHARTING_TOKEN, id: entry.pricechartingId });
      const res = await fetch(`${PRICECHARTING_API}?${query}`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pennies = (await res.json())[field];
      await sleep(1100);
      if (Number.isFinite(pennies) && pennies > 0) {
        return { value: pennies / 100, valueSource: 'PriceCharting', valueAt: new Date().toISOString() };
      }
    } catch (error) {
      warn(`ดึงราคา cert ${entry.cert} ไม่สำเร็จ: ${error.message}`);
    }
  }
  if (Number.isFinite(entry.value)) {
    return { value: entry.value, valueSource: 'กรอกเอง', valueAt: entry.valueDate ?? null };
  }
  if (card?.valueSource === 'PriceCharting') {
    return { value: card.value, valueSource: card.valueSource, valueAt: card.valueAt };
  }
  return { value: null, valueSource: null, valueAt: null };
}

async function main() {
  const { cards: rawEntries = [] } = JSON.parse(await readFile(COLLECTION, 'utf8'));
  const entries = rawEntries.filter((e) => {
    const ok = /^\d{1,12}$/.test(String(e.cert ?? ''));
    if (!ok) warn('มีเลข cert ใน collection.json ที่รูปแบบไม่ถูกต้อง (ข้ามให้แล้ว)');
    return ok;
  }).map((e) => ({ ...e, cert: String(e.cert) }));

  const previous = await loadPrevious();
  const orderIds = [
    ...parseIdList(PSA_ORDER_NUMBERS).map((id) => ({ id, kind: 'order', path: 'GetProgress' })),
    ...parseIdList(PSA_SUBMISSION_NUMBERS).map((id) => ({ id, kind: 'submission', path: 'GetSubmissionProgress' })),
  ];

  let cache = Object.fromEntries((previous.cards ?? []).map((c) => [c.cert, c]));
  let orders = previous.orders ?? [];
  if (PSA_API_TOKEN) {
    orders = await syncOrders(orderIds, previous); // status changes most often, so it goes first
    cache = await syncCerts(entries, previous, Math.max(0, budget - psaCalls));
  } else {
    warn('ยังไม่ได้ตั้ง secret PSA_API_TOKEN');
  }

  const cards = [];
  for (const entry of entries) {
    const card = cache[entry.cert];
    if (!card) continue;
    cards.push({ ...card, ...(await marketValue(entry, card)), note: String(entry.note ?? '').slice(0, 200) });
  }

  await mkdir(new URL('.', OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    configured: Boolean(PSA_API_TOKEN),
    pricingEnabled: Boolean(PRICECHARTING_TOKEN),
    warnings: [...new Set(warnings)],
    cards,
    orders,
  }, null, 2));
  console.log(`Synced ${cards.length} cards, ${orders.length} orders, using ${psaCalls} PSA calls.`);
}

main().catch((error) => {
  console.error(`Sync failed: ${error.message}`);
  process.exit(1);
});
