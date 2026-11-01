// All API-sourced text goes through textContent via el(), so it cannot inject markup.
const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(Boolean));
  return node;
}

const money = (n) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2,
}).format(n);
const count = (n) => new Intl.NumberFormat('th-TH').format(n);
const thaiDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
};
const gradeKey = (card) => (card.grade == null ? 'อื่นๆ' : String(card.grade));
const cardTitle = (card) => card.subject || `Cert ${card.cert}`;
const cardSubtitle = (card) =>
  [card.year, card.brand, card.cardNumber && `#${card.cardNumber}`, card.variety].filter(Boolean).join(' · ');

function renderStats(cards, orders) {
  const priced = cards.filter((c) => c.value != null);
  const total = priced.reduce((sum, c) => sum + c.value, 0);
  const tens = cards.filter((c) => c.grade === 10).length;
  const active = orders.filter((o) => !o.shipped).length;
  const stat = (label, value, note) =>
    el('dl', { class: 'stat' }, el('dt', { text: label }), el('dd', { text: value }, el('small', { text: note })));
  $('stats').replaceChildren(
    stat('การ์ดทั้งหมด', `${count(cards.length)} ใบ`, `${count(new Set(cards.map(gradeKey)).size)} ระดับเกรด`),
    stat('มูลค่ารวมล่าสุด', money(total), `มีราคา ${count(priced.length)} จาก ${count(cards.length)} ใบ`),
    stat('PSA 10', `${count(tens)} ใบ`, cards.length ? `${Math.round((tens / cards.length) * 100)}% ของทั้งหมด` : ''),
    stat('กำลังส่งเกรด', `${count(active)} รายการ`, `ทั้งหมด ${count(orders.length)} รายการ`),
  );
}

function gradeGroups(cards) {
  const groups = new Map();
  for (const card of cards) {
    const key = gradeKey(card);
    const group = groups.get(key) ?? { key, grade: card.grade ?? -1, count: 0, value: 0 };
    group.count += 1;
    group.value += card.value ?? 0;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.grade - a.grade);
}

function renderChart(cards) {
  const groups = gradeGroups(cards);
  const max = Math.max(...groups.map((g) => g.count), 1);
  $('grade-chart').replaceChildren(...groups.map((g) => {
    const bar = el('span', { class: 'bar' });
    bar.style.width = `${(g.count / max) * 100}%`;
    return el('div', {
      class: 'bar-row',
      title: `เกรด ${g.key}: ${count(g.count)} ใบ มูลค่ารวม ${money(g.value)}`,
    },
    el('span', { class: 'bar-label', text: g.key }),
    el('span', { class: 'bar-track' }, bar),
    el('span', { class: 'bar-value', text: `${count(g.count)} ใบ · ${money(g.value)}` }));
  }));
}

function orderBadge(order) {
  if (order.problem) return ['bad', '⚠ มีปัญหา ติดต่อ PSA'];
  if (order.accountingHold) return ['warn', '⚠ ค้างชำระเงิน'];
  if (order.shipped) return ['good', '✓ จัดส่งแล้ว'];
  if (order.gradesReady) return ['good', '✓ เกรดออกแล้ว'];
  return ['', 'กำลังดำเนินการ'];
}

function renderOrders(orders) {
  if (!orders.length) {
    $('orders').replaceChildren(el('p', { class: 'muted', text: 'ยังไม่มีรายการส่งเกรด' }));
    return;
  }
  // Open orders come first; shipped ones sink to the bottom.
  const sorted = [...orders].sort((a, b) => Number(a.shipped) - Number(b.shipped));
  $('orders').replaceChildren(...sorted.map((order) => {
    const [tone, label] = orderBadge(order);
    const current = order.steps.find((s) => !s.done);
    const finished = order.steps.filter((s) => s.done).length;
    return el('div', { class: 'order' },
      el('div', { class: 'order-head' },
        el('span', { text: `${order.kind === 'submission' ? 'Submission' : 'Order'} ${order.id}` }),
        el('span', { class: `badge ${tone}`, text: label })),
      order.steps.length ? el('div', { class: 'steps', role: 'img', 'aria-label': `เสร็จ ${finished} จาก ${order.steps.length} ขั้นตอน` },
        ...order.steps.map((s) => el('span', { class: s.done ? 'done' : '', title: s.name }))) : null,
      el('p', { class: 'muted', text: current ? `ขั้นตอนปัจจุบัน: ${current.name} (${finished}/${order.steps.length})` : `ครบ ${finished} ขั้นตอน` }));
  }));
}

function thumb(card, url, side) {
  if (url) {
    const img = el('img', { src: url, alt: `${side} ${cardTitle(card)}`, loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(placeholder(card, 'โหลดภาพไม่สำเร็จ')));
    return el('div', { class: 'thumb' }, img);
  }
  return el('div', { class: 'thumb' }, placeholder(card, 'ไม่มีภาพจาก PSA'));
}

function placeholder(card, message) {
  return el('div', { class: 'placeholder' }, el('b', { text: card.grade ?? '–' }), message);
}

function openDetail(card) {
  const fact = (label, value) => (value == null || value === ''
    ? []
    : [el('dt', { text: label }), el('dd', { text: value })]);
  const certLink = el('a', {
    href: `https://www.psacard.com/cert/${encodeURIComponent(card.cert)}`,
    target: '_blank', rel: 'noopener noreferrer', text: card.cert,
  });
  $('detail-body').replaceChildren(
    el('h2', { id: 'detail-title', text: cardTitle(card) }),
    el('p', { class: 'muted', text: cardSubtitle(card) }),
    el('div', { class: 'detail-images' }, thumb(card, card.images?.front, 'ด้านหน้า'), thumb(card, card.images?.back, 'ด้านหลัง')),
    el('dl', { class: 'facts' },
      el('dt', { text: 'เลข cert' }), el('dd', {}, certLink),
      ...fact('เกรด', card.gradeLabel),
      ...fact('มูลค่าล่าสุด', card.value != null ? money(card.value) : 'ยังไม่มีราคา'),
      ...fact('แหล่งราคา', card.valueSource),
      ...fact('วันที่ของราคา', card.valueAt && thaiDate(card.valueAt)),
      ...fact('Population เกรดนี้', card.population != null ? count(card.population) : null),
      ...fact('Population เกรดสูงกว่า', card.populationHigher != null ? count(card.populationHigher) : null),
      ...fact('หมายเหตุ', card.note)),
  );
  $('detail').showModal();
}

function renderCards(cards) {
  const query = $('search').value.trim().toLowerCase();
  const grade = $('grade-filter').value;
  const sorters = {
    value: (a, b) => (b.value ?? -1) - (a.value ?? -1),
    grade: (a, b) => (b.grade ?? -1) - (a.grade ?? -1),
    name: (a, b) => cardTitle(a).localeCompare(cardTitle(b), 'th'),
  };
  const shown = cards
    .filter((c) => !grade || gradeKey(c) === grade)
    .filter((c) => !query || `${cardTitle(c)} ${cardSubtitle(c)} ${c.cert}`.toLowerCase().includes(query))
    .sort(sorters[$('sort').value]);
  $('cards').replaceChildren(...shown.map((card) => {
    const button = el('button', { class: 'card', type: 'button' },
      thumb(card, card.images?.front, 'ด้านหน้า'),
      el('div', { class: 'card-body' },
        el('p', { class: 'card-title', text: cardTitle(card) }),
        el('p', { class: 'card-sub', text: cardSubtitle(card) }),
        el('div', { class: 'card-foot' },
          el('span', { text: card.gradeLabel ?? '–' }),
          el('b', { text: card.value != null ? money(card.value) : '–' }))));
    button.addEventListener('click', () => openDetail(card));
    return button;
  }));
  $('no-match').hidden = shown.length > 0;
}

async function loadData(demo) {
  const res = await fetch(`data/${demo ? 'demo' : 'portfolio'}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function init() {
  const demo = new URLSearchParams(location.search).has('demo');
  $('demo-banner').hidden = !demo;
  $('detail-close').addEventListener('click', () => $('detail').close());

  let data;
  try {
    data = await loadData(demo);
  } catch {
    data = { cards: [], orders: [], warnings: [] };
  }
  const { cards = [], orders = [], warnings = [], generatedAt } = data;

  $('updated').textContent = generatedAt ? `อัปเดตล่าสุด ${thaiDate(generatedAt)}` : '';
  $('warnings').replaceChildren(...warnings.map((text) => el('div', { class: 'warning', text })));

  if (!cards.length && !orders.length) {
    $('setup').hidden = false;
    return;
  }
  $('content').hidden = false;
  renderStats(cards, orders);
  renderChart(cards);
  renderOrders(orders);

  $('grade-filter').replaceChildren(
    el('option', { value: '', text: 'ทุกเกรด' }),
    ...gradeGroups(cards).map((g) => el('option', { value: g.key, text: `เกรด ${g.key} (${count(g.count)})` })),
  );
  const refresh = () => renderCards(cards);
  $('search').addEventListener('input', refresh);
  $('grade-filter').addEventListener('change', refresh);
  $('sort').addEventListener('change', refresh);
  refresh();
}

init();
