/* Commercial GA4 only. Enhanced Measurement must be OFF in the GA4 stream. */
(() => {
  'use strict';
  const w = window, d = document;
  const STORAGE_KEY = 'barber.analytics.consent.v1';
  const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
  const LAYER = 'barberCommercialDataLayer';
  const TITLES = Object.freeze({
    '/': 'Barber System',
    '/agenda-online-para-barbearia': 'Agenda online — Barber System',
    '/sistema-barbearia-por-assinatura': 'Assinaturas — Barber System',
    '/controle-financeiro-barbearia': 'Controle financeiro — Barber System',
    '/site-para-barbearia': 'Site para barbearia — Barber System',
    '/sistema-para-barbeiro-autonomo': 'Barbeiro autônomo — Barber System',
    '/aplicativo-cliente-barbearia': 'Área do cliente — Barber System',
    '/precos': 'Preços — Barber System'
  });
  const SENSITIVE_KEYS = ['shop', 'code', 'token', 'access_token', 'refresh_token', 'preview', 'preview_token', 'draft'];
  const measurementHosts = new Set(['sistemadebarbearia.com.br', 'www.sistemadebarbearia.com.br']);

  function pathOf(url) { return url.pathname.replace(/\/+$/, '') || '/'; }
  function allowedPath(path) {
    return Object.hasOwn(TITLES, path) || path === '/blog' || /^\/blog\/(?:categoria\/)?[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
  }
  function context(url = new URL(w.location.href)) {
    const path = pathOf(url);
    // Even an accidental include on accounts/tenant pages must not load Google.
    if (!allowedPath(path) || SENSITIVE_KEYS.some(key => url.searchParams.has(key)) || /(?:^|[?#&])(?:access_token|refresh_token|token|code|type)=[^&]+/i.test(url.hash)) return null;
    return { path, location: url.origin + path, title: TITLES[path] || 'Blog — Barber System', group: path.startsWith('/blog') ? 'blog' : 'commercial' };
  }
  if (!context() || w.BarberAnalytics) return;

  let choice = readChoice(), generation = 0, measurementId = '', active = false;
  let loading = false, sdkLoaded = false, script = null, controller = null, lastPage = null;
  let ui, panel, status, privacy, accept, refuse, pending = [], currentPath = null;
  let readingTimer = null, readingMs = 0, lastTick = 0;
  const seenLeads = new Set(), readPages = new Set(), lastClicks = new Map();

  function readChoice() {
    try {
      const saved = JSON.parse(w.localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved?.version !== 1 || !['accepted', 'declined'].includes(saved.status) || !Number.isFinite(saved.updated_at) || saved.updated_at > Date.now() || Date.now() - saved.updated_at > MAX_AGE) return null;
      return saved.status;
    } catch { return null; }
  }
  function saveChoice(value) {
    choice = value;
    try { w.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, status: value, updated_at: Date.now() })); } catch { /* The choice still applies to this page. */ }
  }
  function safeReferrer() {
    try { const url = new URL(d.referrer); return /^https?:$/.test(url.protocol) ? url.origin : ''; } catch { return ''; }
  }
  function gtag() { w[LAYER].push(arguments); }
  function fields(page) {
    return { send_to: measurementId, page_location: page.location, page_referrer: safeReferrer(), page_title: page.title, content_group: page.group };
  }
  function emit(name, extra = {}) {
    const page = context();
    if (choice !== 'accepted' || !page) return false;
    // Only fixed schemas are created by callers. Never pass event.detail, text or form values.
    const event = { name, page, extra };
    if (active && measurementId && !w['ga-disable-' + measurementId]) { gtag('event', name, { ...fields(page), ...extra }); return true; }
    if (loading && pending.length < 20) { pending.push(event); return true; }
    return false;
  }
  function configureTag() {
    const page = context();
    if (!page || choice !== 'accepted') return;
    const safe = { ...fields(page), send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      ads_data_redaction: true, url_passthrough: false, cookie_domain: w.location.hostname, cookie_path: '/', cookie_flags: 'SameSite=Lax;Secure',
      // Do not inherit arbitrary UTM/search text from location or campaign fields.
      campaign_id: '', campaign_name: '', campaign_source: '', campaign_medium: '', campaign_term: '', campaign_content: '' };
    gtag('set', safe);
    gtag('config', measurementId, safe);
  }
  function markPage() {
    const page = context();
    if (!active || !page || lastPage === page.path) return;
    configureTag();
    if (emit('page_view')) lastPage = page.path;
  }
  function startReading() {
    if (readingTimer !== null) return;
    lastTick = Date.now();
    readingTimer = w.setInterval(() => {
      const now = Date.now(), elapsed = Math.max(0, Math.min(3000, now - lastTick)); lastTick = now;
      const page = context(), article = d.querySelector('.article-body');
      if (!active || !page || !/^\/blog\/[a-z0-9-]+$/.test(page.path) || !article || readPages.has(page.path) || d.visibilityState === 'hidden') return;
      readingMs += elapsed;
      const rect = article.getBoundingClientRect();
      const progress = rect.height > 0 ? Math.max(0, Math.min(1, (w.innerHeight - rect.top) / rect.height)) : 0;
      if (readingMs >= 30000 && progress >= 0.5 && emit('blog_engaged_read', { reading_seconds: 30, percent_scrolled: 50 })) readPages.add(page.path);
    }, 1000);
  }
  function activate() {
    if (choice !== 'accepted' || !context()) return;
    active = true; loading = false; markPage(); startReading();
    const queue = pending; pending = [];
    for (const item of queue) {
      if (context()?.path === item.page.path) emit(item.name, item.extra);
    }
  }
  async function startTracking() {
    if (active || loading || choice !== 'accepted' || !context() || w.location.protocol !== 'https:' || !measurementHosts.has(w.location.hostname)) return;
    const run = ++generation;
    loading = true;
    try {
      controller = typeof AbortController === 'function' ? new AbortController() : null;
      const response = await w.fetch('/analytics-config.json', { credentials: 'omit', cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
      if (!response.ok) throw new Error('Configuration unavailable');
      const config = await response.json();
      if (run !== generation || choice !== 'accepted' || !context()) return;
      const id = typeof config?.measurement_id === 'string' ? config.measurement_id.trim() : '';
      if (!/^G-[A-Z0-9]{6,20}$/.test(id)) { loading = false; pending = []; return; }
      measurementId = id; w['ga-disable-' + id] = false;
      if (!w[LAYER]) w[LAYER] = [];
      gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', personalization_storage: 'denied' });
      gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', personalization_storage: 'denied' });
      if (!sdkLoaded) gtag('js', new Date());
      configureTag();
      if (sdkLoaded) { activate(); return; }
      const tag = d.createElement('script'); script = tag; tag.id = 'barber-commercial-ga4'; tag.async = true;
      tag.referrerPolicy = 'no-referrer';
      tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id) + '&l=' + LAYER;
      tag.onload = () => { if (run === generation) { sdkLoaded = true; activate(); } };
      tag.onerror = () => { if (run === generation) { loading = false; pending = []; script = null; } tag.remove(); };
      d.head.appendChild(tag);
    } catch {
      if (run === generation) { loading = false; pending = []; }
    } finally { if (run === generation) controller = null; }
  }
  function stopTracking() {
    ++generation;
    if (measurementId) w['ga-disable-' + measurementId] = true;
    active = false; loading = false; pending = [];
    try { controller?.abort(); } catch { /* No page interruption. */ }
    controller = null;
    if (script) { script.onload = null; script.onerror = null; script.remove(); script = null; }
    if (w[LAYER]) w[LAYER].length = 0;
    if (readingTimer !== null) { w.clearInterval(readingTimer); readingTimer = null; }
    readingMs = 0;
    // No consent-update ping on refusal. The documented opt-out flag stops GA data.
  }
  function clearCookies() {
    try {
      const names = d.cookie.split(';').map(item => item.trim().split('=')[0]).filter(name => /^_ga/.test(name));
      const parts = w.location.hostname.split('.'), domains = [''];
      for (let i = 0; i < parts.length - 1; i++) { const domain = parts.slice(i).join('.'); domains.push(domain, '.' + domain); }
      const paths = new Set(['/']);
      const segments = w.location.pathname.split('/').filter(Boolean);
      for (let i = 1; i <= segments.length; i++) { const path = '/' + segments.slice(0, i).join('/'); paths.add(path); paths.add(path + '/'); }
      for (const name of names) for (const domain of domains) for (const path of paths) {
        d.cookie = encodeURIComponent(name) + '=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=' + path + (domain ? '; Domain=' + domain : '') + '; SameSite=Lax' + (w.location.protocol === 'https:' ? '; Secure' : '');
      }
    } catch { /* Unavailable cookie storage must not break navigation. */ }
  }
  function updateUi() {
    if (!ui) return;
    ui.hidden = !context();
    status.textContent = choice === 'accepted' ? 'Você permitiu a análise das páginas públicas.' : choice === 'declined' ? 'A análise opcional está desativada.' : 'A análise opcional só começa se você aceitar.';
    privacy.setAttribute('aria-expanded', String(!panel.hidden && !ui.hidden));
  }
  function hidePanel() { panel.hidden = true; updateUi(); privacy.focus(); }
  function openPreferences() {
    if (!context() || !ui) return false;
    panel.hidden = false; updateUi(); refuse.focus(); return true;
  }
  function syncPath() {
    const page = context(); updateUi();
    if (!page) { stopTracking(); lastPage = null; currentPath = null; return; }
    if (page.path !== currentPath) { currentPath = page.path; readingMs = 0; lastTick = Date.now(); }
    if (active) markPage(); else if (choice === 'accepted') void startTracking();
  }
  function leadSubmitted(event) {
    if (choice !== 'accepted' || !context()) return;
    // UUID is used only for in-memory deduplication. It is never sent to GA4.
    const id = typeof event.detail?.submission_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.detail.submission_id) ? event.detail.submission_id : 'page:' + context().path;
    if (seenLeads.has(id) || seenLeads.size >= 100) return;
    if (emit('generate_lead', { lead_source: 'commercial_form' })) seenLeads.add(id);
  }
  function ctaClicked(event) {
    if (choice !== 'accepted' || !active || !context()) return;
    const link = event.target?.closest?.('a[href]');
    if (!link || link.closest('[data-analytics-ui]') || !link.matches('a.button, a.nav-cta, a.read-link, .blog-cta a')) return;
    let url;
    try { url = new URL(link.getAttribute('href'), w.location.href); } catch { return; }
    if (url.origin !== w.location.origin || !context(url)) return;
    const path = pathOf(url);
    let type;
    if (url.hash === '#solicitar') type = 'request_information';
    else if (url.hash === '#recursos') type = 'explore_features';
    else if (url.hash) return;
    else type = path === '/precos' ? 'view_pricing' : /^\/blog\/[a-z0-9-]+$/.test(path) ? 'read_article' : 'view_solution';
    const key = type + ':' + path, now = Date.now();
    if (now - (lastClicks.get(key) || 0) < 600) return;
    if (emit('cta_click', { cta_type: type, target_path: path })) lastClicks.set(key, now);
  }
  function initialize() {
    if (!context()) return;
    ui = d.createElement('div'); ui.id = 'barber-analytics-consent'; ui.setAttribute('data-analytics-ui', '');
    ui.innerHTML = '<section id="ba-preferences" class="ba-panel" role="dialog" aria-modal="false" aria-labelledby="ba-title" hidden><div class="ba-heading"><span class="ba-icon" aria-hidden="true">◈</span><h2 id="ba-title">Sua privacidade, sua escolha</h2><button class="ba-close" type="button" aria-label="Fechar preferências">×</button></div><p>Podemos usar o Google Analytics para entender as visitas ao site e ao blog e os cliques nos botões? Ele só é ativado se você aceitar. A área do sistema e as páginas das barbearias ficam fora dessa análise. O telefone de atendimento e o conteúdo das conversas no WhatsApp não são enviados ao Google Analytics.</p><p><a class="ba-policy-link" href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">Como o Google usa dados de sites parceiros <span aria-hidden="true">↗</span></a></p><p class="ba-status" role="status" aria-live="polite"></p><div class="ba-actions"><button class="ba-button ba-refuse" type="button">Recusar</button><button class="ba-button ba-accept" type="button">Aceitar análise</button></div><small>Você pode continuar navegando se recusar e mudar de ideia depois em Privacidade.</small></section><button class="ba-privacy" type="button" aria-controls="ba-preferences" aria-expanded="false"><span aria-hidden="true">◈</span> Privacidade</button>';
    d.body.appendChild(ui);
    panel = ui.querySelector('.ba-panel'); status = ui.querySelector('.ba-status'); privacy = ui.querySelector('.ba-privacy');
    accept = ui.querySelector('.ba-accept'); refuse = ui.querySelector('.ba-refuse');
    panel.hidden = choice !== null;
    privacy.addEventListener('click', () => panel.hidden ? openPreferences() : hidePanel());
    ui.querySelector('.ba-close').addEventListener('click', hidePanel);
    accept.addEventListener('click', () => { saveChoice('accepted'); hidePanel(); void startTracking(); });
    refuse.addEventListener('click', () => { saveChoice('declined'); stopTracking(); clearCookies(); hidePanel(); });
    d.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden && ui.contains(d.activeElement)) hidePanel(); });
    d.addEventListener('barber:lead-submitted', leadSubmitted);
    d.addEventListener('click', ctaClicked);
    d.addEventListener('visibilitychange', () => { lastTick = Date.now(); });
    w.addEventListener('storage', event => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      choice = readChoice();
      if (choice !== 'accepted') { stopTracking(); clearCookies(); panel.hidden = choice !== null; }
      syncPath();
    });
    for (const method of ['pushState', 'replaceState']) {
      const original = w.history[method];
      w.history[method] = function () {
        try { if (arguments[2] != null && !context(new URL(String(arguments[2]), w.location.href))) stopTracking(); } catch { /* Native history validates the URL. */ }
        try { return original.apply(this, arguments); } finally { syncPath(); }
      };
    }
    w.addEventListener('popstate', syncPath); w.addEventListener('hashchange', syncPath);
    if (choice === 'declined') clearCookies();
    syncPath();
  }
  // Guard before DOMContentLoaded so duplicate deferred includes cannot register twice.
  w.BarberAnalytics = Object.freeze({ openPreferences, getConsent: () => choice });
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})();
