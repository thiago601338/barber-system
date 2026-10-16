const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../public/analytics.js'), 'utf8');
const KEY = 'barber.analytics.consent.v1';
const ID = 'G-ABCD123456';
const UUID = '90c4f4b5-5c5c-434a-a01b-5978a2576251';
const UUID2 = 'fa4ef620-c0e5-4643-b0ad-79b5e9f94dc7';

// Small browser fixture: no SDK is evaluated and no network request can leave this process.
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback, options) {
    const list = this.listeners.get(name) || [];
    list.push({ callback, once: options?.once }); this.listeners.set(name, list);
  }
  dispatch(name, detail = {}) {
    const event = { type: name, ...detail };
    for (const item of [...(this.listeners.get(name) || [])]) {
      item.callback(event);
      if (item.once) this.listeners.set(name, this.listeners.get(name).filter(value => value !== item));
    }
  }
}
class Element extends Events {
  constructor(tag, document) { super(); this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.attributes = {}; this.hidden = false; this.selectors = new Map(); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.removed = true; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelector(selector) { return this.selectors.get(selector) || null; }
  contains(child) { return child === this || this.children.some(item => item.contains(child)); }
  focus() { this.document.activeElement = this; }
  click() { this.dispatch('click', { target: this }); }
  set innerHTML(value) {
    this.html = value;
    // Only consent controls are represented; assertions exercise the real listeners.
    for (const selector of ['.ba-panel', '.ba-status', '.ba-privacy', '.ba-accept', '.ba-refuse', '.ba-close']) {
      const child = new Element(selector === '.ba-panel' ? 'section' : 'button', this.document);
      this.selectors.set(selector, child); this.appendChild(child);
    }
    this.selectors.get('.ba-panel').hidden = true;
  }
}
function fixture(options = {}) {
  let now = 1791230400000;
  const requests = [], commands = [], cookieWrites = [], storage = new Map(), intervals = new Map();
  const cookies = new Map(Object.entries(options.cookies || {}));
  let timerId = 0;
  if (options.choice) storage.set(KEY, JSON.stringify({ version: 1, status: options.choice, updated_at: now }));
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const d = new Events();
  d.readyState = options.readyState || 'complete'; d.referrer = options.referrer || ''; d.visibilityState = 'visible';
  d.createElement = tag => new Element(tag, d); d.body = new Element('body', d); d.head = new Element('head', d);
  d.querySelector = selector => selector === '.article-body' ? options.article || null : null;
  Object.defineProperty(d, 'cookie', {
    get: () => [...cookies].map(([key, value]) => key + '=' + value).join('; '),
    set: value => { cookieWrites.push(value); if (/Max-Age=0/.test(value)) cookies.delete(decodeURIComponent(value.split('=')[0])); }
  });
  const w = new Events(); w.location = new URL(options.url || 'https://sistemadebarbearia.com.br/'); w.innerHeight = 800;
  w.localStorage = {
    getItem: key => { if (options.storageFailure) throw Error('Storage denied'); return storage.get(key) ?? null; },
    setItem: (key, value) => { if (options.storageFailure) throw Error('Storage denied'); storage.set(key, value); }
  };
  w.fetch = async (url, init) => {
    requests.push({ url, init });
    if (options.configFetch) return options.configFetch(url, init);
    if (options.configFailure) throw Error('Offline');
    return { ok: options.configOk !== false, json: async () => ({ measurement_id: options.measurementId ?? ID }) };
  };
  w.setInterval = callback => { intervals.set(++timerId, callback); return timerId; };
  w.clearInterval = id => intervals.delete(id);
  w.history = Object.fromEntries(['pushState', 'replaceState'].map(method => [method, function (_, __, url) { if (url != null) w.location = new URL(url, w.location.href); }]));
  Object.defineProperty(w, 'barberCommercialDataLayer', {
    get: () => w.layer,
    set: layer => {
      w.layer = layer;
      const push = layer.push;
      layer.push = function (...args) { for (const command of args) commands.push(JSON.parse(JSON.stringify(Array.from(command)))); return push.apply(this, args); };
    }
  });
  const sandbox = vm.createContext({ window: w, document: d, URL, AbortController, Date: Clock });
  const execute = () => vm.runInContext(source, sandbox);
  execute();
  const control = name => d.body.children.find(item => item.id === 'barber-analytics-consent')?.querySelector('.ba-' + name);
  return {
    w, d, requests, commands, cookies, cookieWrites, storage, execute, control,
    scripts: () => d.head.children.filter(item => item.tagName === 'SCRIPT'),
    googleRequests: () => d.head.children.filter(item => /^https:\/\/www\.googletagmanager\.com\//.test(item.src || '')),
    events: name => commands.filter(item => item[0] === 'event' && (!name || item[1] === name)),
    loadSdk: () => { const script = d.head.children.at(-1); assert.ok(script?.onload, 'Expected a simulated Google script'); script.onload(); },
    lead: detail => d.dispatch('barber:lead-submitted', { detail }),
    clickLink: href => d.dispatch('click', { target: {
      closest: selector => selector === 'a[href]' ? { closest: () => null, matches: () => true, getAttribute: () => href } : null
    } }),
    advance: ms => { for (let elapsed = 0; elapsed < ms; elapsed += 1000) { now += 1000; for (const callback of [...intervals.values()]) callback(); } }
  };
}
async function settle() { await new Promise(resolve => setImmediate(resolve)); }
async function accepted(options = {}) {
  const f = fixture(options); f.control('accept').click(); await settle(); f.loadSdk(); return f;
}

test('sem consentimento ou após recusa não carrega Google nem consulta configuração', async () => {
  const f = fixture(); assert.equal(f.control('panel').hidden, false);
  const notice = f.d.body.children[0].html;
  assert.match(notice, /Ele só é ativado se você aceitar/);
  assert.match(notice, /O telefone de atendimento e o conteúdo das conversas no WhatsApp não são enviados ao Google Analytics/);
  assert.match(notice, /href="https:\/\/policies\.google\.com\/technologies\/partner-sites" target="_blank" rel="noopener noreferrer"/);
  assert.equal(f.requests.length, 0); assert.equal(f.googleRequests().length, 0); assert.equal(f.commands.length, 0);
  f.lead({ submission_id: UUID }); f.clickLink('/precos');
  f.control('refuse').click(); await settle();
  assert.equal(f.requests.length, 0); assert.equal(f.commands.length, 0);
  assert.equal(JSON.parse(f.storage.get(KEY)).status, 'declined');
  assert.equal(f.w.BarberAnalytics.openPreferences(), true); assert.equal(f.control('panel').hidden, false);
});

test('áreas privadas, tenants, previews e retorno de autenticação nunca inicializam coleta', async () => {
  for (const suffix of ['/app', '/app/financeiro', '/entrar', '/b/kingsman', '/b/kingsman/agendar', '/api/blog/preview', '/?shop=kingsman', '/?code=auth-secret', '/blog/um-post?preview=true', '/#access_token=secret', '/blog/categoria/teste?draft=1']) {
    const f = fixture({ url: 'https://sistemadebarbearia.com.br' + suffix, choice: 'accepted' });
    await settle(); assert.equal(f.w.BarberAnalytics, undefined, suffix); assert.equal(f.d.body.children.length, 0, suffix);
    assert.equal(f.requests.length, 0, suffix); assert.equal(f.commands.length, 0, suffix);
  }
});

test('aceite envia somente URL sem query/hash, título fixo, referência de origem e recursos de anúncios negados', async () => {
  const f = await accepted({ url: 'https://sistemadebarbearia.com.br/precos?email=cliente@example.test&utm_term=telefone-secreto#cpf=123', referrer: 'https://outro.test/pessoa/cliente?email=segredo@example.test#cpf=999' });
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, '/analytics-config.json'); assert.equal(f.requests[0].init.credentials, 'omit');
  const script = f.scripts()[0]; assert.equal(script.referrerPolicy, 'no-referrer'); assert.match(script.src, /id=G-ABCD123456&l=barberCommercialDataLayer$/);
  const pages = f.events('page_view'); assert.equal(pages.length, 1);
  assert.equal(pages[0][2].page_location, 'https://sistemadebarbearia.com.br/precos');
  assert.equal(pages[0][2].page_referrer, 'https://outro.test'); assert.equal(pages[0][2].page_title, 'Preços — Barber System');
  const configuration = f.commands.find(command => command[0] === 'config')[2];
  assert.equal(configuration.send_page_view, false); assert.equal(configuration.allow_google_signals, false); assert.equal(configuration.allow_ad_personalization_signals, false);
  for (const key of ['campaign_id', 'campaign_name', 'campaign_source', 'campaign_medium', 'campaign_term', 'campaign_content']) assert.equal(configuration[key], '');
  const consent = f.commands.filter(command => command[0] === 'consent').at(-1)[2];
  assert.equal(consent.analytics_storage, 'granted'); for (const key of ['ad_storage', 'ad_user_data', 'ad_personalization', 'personalization_storage']) assert.equal(consent[key], 'denied');
  assert.doesNotMatch(JSON.stringify(f.commands), /cliente|segredo|email=|telefone-secreto|cpf=|utm_term|outro\.test\/pessoa/);
});

test('configuração vazia/inválida, falha de rede e preview local não enviam medição', async () => {
  for (const options of [{ measurementId: '' }, { measurementId: 'G-<script>' }, { configFailure: true }, { configOk: false }]) {
    const f = fixture(options); f.control('accept').click(); await settle();
    assert.equal(f.googleRequests().length, 0); assert.equal(f.commands.length, 0); assert.equal(f.w.BarberAnalytics.getConsent(), 'accepted');
  }
  for (const url of ['http://localhost:5173/', 'https://deploy-preview.test/', 'https://barber-system-yqu5.netlify.app/']) {
    const f = fixture({ url, choice: 'accepted' }); await settle(); assert.equal(f.requests.length, 0); assert.equal(f.googleRequests().length, 0);
  }
});

test('falha do armazenamento preserva navegação e respeita aceite/recusa em memória', async () => {
  const f = await accepted({ storageFailure: true, cookies: { _ga: 'analytics', _ga_ABCD123456: 'analytics2', supabase_auth: 'session', preference: 'theme' } });
  assert.equal(f.events('page_view').length, 1); assert.equal(f.w.BarberAnalytics.getConsent(), 'accepted');
  f.control('refuse').click(); assert.equal(f.w.BarberAnalytics.getConsent(), 'declined');
  assert.equal(f.w['ga-disable-' + ID], true); assert.equal(f.scripts().length, 0);
  assert.deepEqual([...f.cookies.keys()], ['supabase_auth', 'preference']);
  assert.ok(f.cookieWrites.every(value => /^_ga/.test(value))); assert.ok(f.cookieWrites.some(value => value.includes('Domain=.sistemadebarbearia.com.br')));
  const count = f.commands.length; f.lead({ submission_id: UUID }); f.clickLink('/precos'); f.advance(40000); assert.equal(f.commands.length, count);
});

test('conversão depende do evento de sucesso, deduplica UUID e ignora dados pessoais do evento', async () => {
  const f = await accepted(); f.clickLink('/#solicitar'); f.d.dispatch('submit', { target: {} });
  assert.equal(f.events('generate_lead').length, 0);
  f.lead({ submission_id: UUID, email: 'pessoa@example.test', phone: '11999999999', name: 'Nome Privado', value: 10000 });
  f.lead({ submission_id: UUID }); f.lead({ submission_id: UUID2 });
  assert.equal(f.events('generate_lead').length, 2);
  const payload = f.events('generate_lead')[0][2]; assert.equal(payload.lead_source, 'commercial_form');
  assert.deepEqual(Object.keys(payload).sort(), ['content_group', 'lead_source', 'page_location', 'page_referrer', 'page_title', 'send_to'].sort());
  assert.doesNotMatch(JSON.stringify(f.commands), /pessoa@example|11999999999|Nome Privado|90c4f4b5|fa4ef620|10000/);
});

test('não reenvia sucesso anterior ao consentimento e esvazia confirmação pendente na revogação', async () => {
  const f = fixture(); f.lead({ submission_id: UUID }); f.control('accept').click(); await settle(); f.loadSdk();
  assert.equal(f.events('generate_lead').length, 0);
  const pending = fixture(); pending.control('accept').click(); await settle();
  pending.lead({ submission_id: UUID }); pending.lead({ submission_id: UUID });
  const staleLoad = pending.scripts()[0].onload; pending.control('refuse').click(); staleLoad();
  assert.equal(pending.events('generate_lead').length, 0); assert.equal(pending.events('page_view').length, 0);
  pending.control('accept').click(); await settle(); pending.loadSdk();
  assert.equal(pending.events('generate_lead').length, 0);
  pending.lead({ submission_id: UUID2 }); assert.equal(pending.events('generate_lead').length, 1);
});

test('confirmação durante carregamento é enviada uma vez após SDK pronto', async () => {
  const f = fixture(); f.control('accept').click(); await settle();
  f.lead({ submission_id: UUID }); f.lead({ submission_id: UUID }); assert.equal(f.events('generate_lead').length, 0);
  f.loadSdk(); assert.equal(f.events('generate_lead').length, 1);
  f.lead({ submission_id: UUID }); assert.equal(f.events('generate_lead').length, 1);
});

test('CTAs registram somente destino público limpo e não capturam WhatsApp/acesso/formulário', async () => {
  const f = await accepted();
  for (const link of ['/entrar?email=secret', '/b/loja', '/app', 'mailto:secret@example.test', 'https://wa.me/5511999999999', '/?shop=loja']) f.clickLink(link);
  assert.equal(f.events('cta_click').length, 0);
  f.clickLink('/precos?email=cliente@example.test&utm_term=segredo');
  assert.equal(f.events('cta_click').length, 1); assert.equal(f.events('cta_click')[0][2].target_path, '/precos');
  assert.equal(f.events('cta_click')[0][2].cta_type, 'view_pricing'); assert.doesNotMatch(JSON.stringify(f.commands), /secret|cliente|segredo|55119999|@/);
});

test('navegação interna bloqueia coleta imediatamente e só retoma em rota pública permitida', async () => {
  const f = await accepted(); const count = f.commands.length;
  f.w.history.pushState({}, '', '/b/kingsman?cliente=privado');
  assert.equal(f.w['ga-disable-' + ID], true); assert.equal(f.d.body.children[0].hidden, true);
  f.lead({ submission_id: UUID }); f.clickLink('/precos'); f.advance(40000); assert.equal(f.commands.length, count);
  f.w.history.replaceState({}, '', '/blog/controle-da-agenda?q=segredo'); await settle();
  assert.equal(f.d.body.children[0].hidden, false); assert.equal(f.events('page_view').length, 2);
  assert.equal(f.events('page_view').at(-1)[2].page_location, 'https://sistemadebarbearia.com.br/blog/controle-da-agenda');
  assert.doesNotMatch(JSON.stringify(f.commands), /kingsman|privado|segredo|cliente=/);
});

test('revogação durante configuração pendente impede carregar Google quando a resposta chega', async () => {
  let respond;
  const f = fixture({ configFetch: () => new Promise(resolve => { respond = resolve; }) });
  f.control('accept').click(); f.control('refuse').click();
  assert.equal(f.requests[0].init.signal.aborted, true);
  respond({ ok: true, json: async () => ({ measurement_id: ID }) }); await settle();
  assert.equal(f.googleRequests().length, 0); assert.equal(f.commands.length, 0);
});

test('carregamento duplicado antes do DOM pronto não duplica controles, eventos ou conversões', async () => {
  const f = fixture({ readyState: 'loading', choice: 'accepted' }); f.execute();
  f.d.readyState = 'complete'; f.d.dispatch('DOMContentLoaded'); await settle(); f.loadSdk();
  assert.equal(f.d.body.children.length, 1); assert.equal(f.requests.length, 1); assert.equal(f.events('page_view').length, 1);
  f.lead({ submission_id: UUID }); assert.equal(f.events('generate_lead').length, 1);
});

test('recusa em outra aba interrompe SDK e remove somente cookies de análise', async () => {
  const f = await accepted({ cookies: { _ga: 'cookie', session: 'private' } });
  f.storage.set(KEY, JSON.stringify({ version: 1, status: 'declined', updated_at: 1791230400000 }));
  const count = f.commands.length; f.w.dispatch('storage', { key: KEY }); f.lead({ submission_id: UUID });
  assert.equal(f.w.BarberAnalytics.getConsent(), 'declined'); assert.equal(f.w['ga-disable-' + ID], true); assert.equal(f.commands.length, count);
  assert.deepEqual([...f.cookies.keys()], ['session']);
});

test('leitura do blog exige tempo visível e avanço no artigo, sem enviar texto da página', async () => {
  const article = { getBoundingClientRect: () => ({ top: 0, height: 1000 }) };
  const f = await accepted({ url: 'https://sistemadebarbearia.com.br/blog/organizar-agenda?q=email@example.test', article });
  f.d.visibilityState = 'hidden'; f.advance(40000); assert.equal(f.events('blog_engaged_read').length, 0);
  f.d.visibilityState = 'visible'; f.d.dispatch('visibilitychange'); f.advance(29000); assert.equal(f.events('blog_engaged_read').length, 0);
  f.advance(1000); assert.equal(f.events('blog_engaged_read').length, 1); f.advance(40000); assert.equal(f.events('blog_engaged_read').length, 1);
  assert.equal(f.events('blog_engaged_read')[0][2].reading_seconds, 30); assert.doesNotMatch(JSON.stringify(f.commands), /email@example|\?q=/);
});
