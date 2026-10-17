import json, os, re, sys, time
sys.path.insert(0, '/home/claude/videos')
from playwright.sync_api import sync_playwright
import mask

BASE = 'https://sistemadebarbearia.com.br'
STATE = '/home/claude/videos/state.json'
EMAIL = 'gravacao.videos@sistemadebarbearia.com.br'
PW = open('/home/claude/videos/.rec_pw').read().strip()
REC_UID = '96ecb634-3b14-408a-bbed-e488c4c87885'
KINGSMAN = '4fe40cd6-e636-4b7e-a99c-67e887886e80'
VIEW = {'width': 1280, 'height': 800}

# Nenhuma gravação salva nada: escritas são respondidas aqui, sem chegar ao servidor.
API_ALLOW = re.compile(r'/api/(whatsapp/simulate|whatsapp/config|availability|slots|reports?|public|blog|client-manifest|brand|ai-help/usage)', re.I)
RPC_WRITE = re.compile(r'/rpc/(create|insert|update|delete|save|set_|upsert|cancel|confirm|book_|apply|register|close|open_|record|mark|accept|offer|redeem|import|reset|send|start|finish|complete|pay|refund|add_|remove|toggle|assign|generate|sync|link|unlink|approve|reject|archive|restore|publish|schedule|claim)', re.I)

def guard(context, extra=None):
    """Bloqueia gravações no banco e responde com sucesso fictício."""
    def handler(route):
        req = route.request
        url = req.url
        if extra:
            res = extra(req)
            if callable(res):  # altera a resposta real (já com dados trocados)
                resp = route.fetch()
                data = json.loads(mask.rewrite(url, resp.body()).decode())
                return route.fulfill(response=resp, body=json.dumps(res(data), ensure_ascii=False))
            if res is not None:
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(res, ensure_ascii=False))
        if req.method in ('PATCH', 'DELETE', 'PUT'):
            return route.fulfill(status=200, content_type='application/json', body='[]')
        if req.method == 'POST' and '/rest/v1/' in url and '/rpc/' not in url:
            return route.fulfill(status=201, content_type='application/json', body='[]')
        if req.method == 'POST' and '/rpc/' in url and RPC_WRITE.search(url):
            return route.fulfill(status=200, content_type='application/json', body='null')
        if req.method == 'POST' and '/api/' in url and not API_ALLOW.search(url):
            return route.fulfill(status=200, content_type='application/json', body='{"ok":true}')
        return route.fallback()
    context.route(re.compile(r'https://(oyjiiqbsbshfdgdaxbus\.supabase\.co/(rest|functions)/|sistemadebarbearia\.com\.br/api/).*'), handler)

def new_context(p, record_dir=None, extra=None, state=True, viewport=VIEW):
    b = p.chromium.launch(args=['--font-render-hinting=none'])
    opts = dict(viewport=viewport, locale='pt-BR', timezone_id='America/Maceio', device_scale_factor=1)
    if state and os.path.exists(STATE):
        opts['storage_state'] = STATE
    if record_dir:
        opts['record_video_dir'] = record_dir
        opts['record_video_size'] = viewport
    ctx = b.new_context(**opts)
    mask.install(ctx)      # troca de dados pessoais (registrada primeiro, roda por último)
    guard(ctx, extra)      # bloqueio de escrita e respostas fictícias (roda primeiro)
    return b, ctx

def login(p):
    b, ctx = new_context(p, state=False)
    pg = ctx.new_page()
    pg.goto(BASE + '/entrar'); pg.wait_for_timeout(2000)
    pg.fill('input[type=email]', EMAIL); pg.fill('input[type=password]', PW)
    pg.keyboard.press('Enter'); pg.wait_for_selector('[data-tour-nav]', timeout=30000)
    ctx.storage_state(path=STATE); b.close()

CURSOR_JS = r"""
(() => {
  if (window.__bsCursor) return; window.__bsCursor = 1;
  const add = () => {
    const c = document.createElement('div'); c.id = 'bs-cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#1D1C24" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {position:'fixed', left:'0', top:'0', zIndex:2147483647, pointerEvents:'none', transition:'transform .55s cubic-bezier(.22,.8,.3,1)', transform:'translate(720px,450px)', filter:'drop-shadow(0 3px 6px rgba(0,0,0,.25))'});
    document.documentElement.appendChild(c);
    const ring = document.createElement('div'); ring.id = 'bs-ring';
    Object.assign(ring.style, {position:'fixed', width:'44px', height:'44px', marginLeft:'-22px', marginTop:'-22px', borderRadius:'50%', border:'3px solid #C65B3D', zIndex:2147483646, pointerEvents:'none', opacity:'0', transform:'scale(.4)'});
    document.documentElement.appendChild(ring);
    window.__bsMove = (x, y) => { c.style.transform = `translate(${x-4}px,${y-3}px)`; };
    window.__bsClick = (x, y) => { ring.style.left = x+'px'; ring.style.top = y+'px'; ring.animate([{opacity:.9, transform:'scale(.4)'},{opacity:0, transform:'scale(1.5)'}], {duration:650, easing:'ease-out'}); };
    const st = document.createElement('style'); st.textContent = '.floating-ai-launcher,.floating-ai-help,.floating-help{display:none!important} ::-webkit-scrollbar{width:0;height:0}';
    document.documentElement.appendChild(st);
  };
  if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
})();
"""

class Director:
    """Executa os passos de um roteiro com cursor visível e pausas medidas."""
    def __init__(self, page):
        self.pg = page
        page.add_init_script(CURSOR_JS)

    def _ensure_cursor(self):
        self.pg.evaluate(CURSOR_JS)

    def move_to(self, loc, dur=420):
        self._ensure_cursor()
        loc.scroll_into_view_if_needed(timeout=8000)
        box = loc.bounding_box()
        if not box:
            return None
        x, y = box['x'] + min(box['width'] / 2, 60), box['y'] + box['height'] / 2
        self.pg.evaluate(f'window.__bsMove && window.__bsMove({x},{y})')
        self.pg.mouse.move(x, y, steps=6)
        self.pg.wait_for_timeout(dur)
        return x, y

    def click(self, loc, after=900):
        pos = self.move_to(loc)
        if pos:
            self.pg.evaluate(f'window.__bsClick && window.__bsClick({pos[0]},{pos[1]})')
        loc.click(timeout=8000)
        self.pg.wait_for_timeout(after)

    def nav(self, key, after=2200):
        self.click(self.pg.locator(f'[data-tour-nav="{key}"]'), after)

    def text(self, t, exact=False, nth=0):
        return self.pg.get_by_text(t, exact=exact).nth(nth)

    def role(self, role, name, nth=0):
        return self.pg.get_by_role(role, name=name).nth(nth)

    def type(self, loc, txt, delay=55, after=600):
        self.click(loc, 300)
        loc.press_sequentially(txt, delay=delay)
        self.pg.wait_for_timeout(after)

    def scroll(self, dy, steps=12, after=600):
        for _ in range(steps):
            self.pg.mouse.wheel(0, dy / steps)
            self.pg.wait_for_timeout(35)
        self.pg.wait_for_timeout(after)

    def hover(self, loc, after=1200):
        self.move_to(loc, after)

    def wait(self, ms):
        self.pg.wait_for_timeout(ms)

def _select(self, loc, after=900, **kw):
    self.click(loc, 250)
    loc.select_option(**kw)
    self.pg.wait_for_timeout(after)
Director.select = _select

def _close_modal(self, after=700):
    btn = self.pg.locator('[role=dialog] button[aria-label*="echar"], .modal button[aria-label*="echar"], button.modal-close').last
    try:
        if btn.count():
            self.click(btn, after); return
    except Exception:
        pass
    self.pg.keyboard.press('Escape'); self.pg.wait_for_timeout(after)
Director.close_modal = _close_modal

def _modal(self):
    return self.pg.locator('[role=dialog], .modal').last
Director.modal = _modal

def _scroll_to(self, loc, after=700, block='center'):
    loc.evaluate(f'e=>e.scrollIntoView({{behavior:"smooth",block:"{block}"}})')
    self.pg.wait_for_timeout(after)
Director.scroll_to = _scroll_to

def fake_slots(day='2026-10-19', times=('09:00','09:40','10:20','11:40','14:00','14:40','15:20','16:40','17:20'), dur=40):
    out = []
    for t in times:
        h, m = map(int, t.split(':'))
        e = h * 60 + m + dur
        out.append({'starts_at': f'{day}T{t}:00-03:00', 'ends_at': f'{day}T{e//60:02d}:{e%60:02d}:00-03:00'})
    return out
