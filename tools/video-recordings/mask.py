"""Troca dados pessoais nas respostas da API antes de chegarem à tela.

Nada real (nome de cliente/barbeiro, telefone, e-mail, foto, observação, mensagem)
chega ao navegador de gravação: as respostas JSON do Supabase e das funções do site
são reescritas com valores fictícios determinísticos. Valores em dinheiro são
multiplicados por um fator fixo, para os números não serem os reais.
"""
import hashlib, json, re

FIRST = ['Lucas','Mateus','Rafael','Bruno','Diego','Felipe','Gustavo','Henrique','Igor','João','Leonardo','Marcelo',
 'Nicolas','Otávio','Pedro','Renan','Samuel','Thiago','Vinícius','Wesley','André','Caio','Danilo','Eduardo','Fábio',
 'Gabriel','Hugo','Ítalo','Jonas','Kauã','Luan','Murilo','Natan','Paulo','Ricardo','Sérgio','Tomás','Victor','Arthur',
 'Davi','Enzo','Heitor','Miguel','Bernardo','Lorenzo','Benício','Anderson','Cristiano','Márcio','Rodrigo','Alex','Breno',
 'Carlos','Daniel','Elias','Fernando','Gilberto','Hélio','Jorge','Leandro','Mário','Nelson','Patrick','Roberto','Wagner']
LAST = ['Almeida','Barros','Campos','Duarte','Esteves','Farias','Gomes','Holanda','Lima','Moura','Nogueira','Oliveira',
 'Pereira','Queiroz','Rocha','Santos','Teixeira','Vieira','Xavier','Azevedo','Brandão','Cardoso','Dias','Freitas',
 'Guimarães','Lopes','Machado','Medeiros','Nunes','Pinto','Ramos','Siqueira','Torres','Valente','Andrade','Bezerra',
 'Cavalcante','Fonseca','Leite','Monteiro','Peixoto','Rezende','Tavares','Viana','Coelho','Cunha','Matos','Prado']
FACTOR = 0.83

def _h(s: str) -> int:
    return int(hashlib.sha256(s.encode('utf-8')).hexdigest()[:12], 16)

def fake_name(orig: str) -> str:
    if not orig or not str(orig).strip():
        return orig
    h = _h(str(orig))
    parts = str(orig).split()
    if len(parts) == 1:
        return FIRST[h % len(FIRST)]
    return f"{FIRST[h % len(FIRST)]} {LAST[(h // 97) % len(LAST)]}"

def fake_phone(orig: str) -> str:
    h = _h(str(orig))
    n = f"{h % 10**8:08d}"
    digits = re.sub(r'\D', '', str(orig))
    if digits.startswith('55') and len(digits) >= 12:
        return f"55829{n}"
    return f"(82) 9{n[:4]}-{n[4:]}"

def fake_email(orig: str) -> str:
    h = _h(str(orig))
    return f"{FIRST[h % len(FIRST)].lower().replace('í','i').replace('ã','a').replace('é','e').replace('ô','o').replace('á','a').replace('ú','u').replace('ç','c')}{h % 1000}@exemplo.com"

PERSON_KEYS = re.compile(r'^(client_name|customer_name|barber_name|professional_name|staff_name|member_name|display_name|full_name|contact_name|author_name|owner_name|payer_name|referrer_name|referred_name|client_full_name|nome|first_name|last_name|nickname|profile_name|wa_name|sender_name|created_by_name|responsible_name)$', re.I)
PHONE_KEYS = re.compile(r'(phone|whatsapp|telefone|celular|mobile|wa_id|msisdn)', re.I)
EMAIL_KEYS = re.compile(r'(^|_)e?mail$', re.I)
DROP_KEYS = re.compile(r'^(avatar_path|avatar_url|photo_url|photo_path|picture|profile_picture_url|cpf|document|document_number|birth_date|birthday|address|street|instagram|instagram_handle|notes|note|observations|observation|preferences|allergies|internal_note|care_notes|body|text|content|message|last_message|last_message_preview|preview|caption|transcript)$', re.I)
MONEY_KEYS = re.compile(r'(_cents$|^amount$|^price$|^total$|^value$|revenue|_amount$|^balance|^subtotal|^discount|commission|^cost|_cost$|^gross|^net|^paid|ticket|^expected|^received|^margin_value)', re.I)
PERSON_TABLES = re.compile(r'/rest/v1/(clients|profiles|memberships|client_[a-z_]+|whatsapp_conversations|whatsapp_messages|platform_leads|loyalty_referrals)\b')

def _money(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return int(round(v * FACTOR))
    if isinstance(v, float):
        return round(v * FACTOR, 2)
    if isinstance(v, str) and re.fullmatch(r'-?\d+(\.\d+)?', v):
        f = float(v) * FACTOR
        return f"{f:.2f}" if '.' in v else str(int(round(f)))
    return v

def walk(obj, person_ctx=False):
    if isinstance(obj, list):
        return [walk(x, person_ctx) for x in obj]
    if not isinstance(obj, dict):
        return obj
    looks_person = (person_ctx or any(k in obj for k in ('phone', 'phone_e164', 'email', 'birth_date', 'client_id'))) and not any(k in obj for k in ('slug', 'onboarding_completed_at', 'duration_minutes', 'sku'))
    out = {}
    for k, v in obj.items():
        if isinstance(v, (dict, list)):
            child_ctx = bool(re.match(r'^(client|clients|customer|profile|profiles|member|membership|memberships|barber|barbers|staff|contact|author)s?$', k, re.I))
            out[k] = walk(v, child_ctx)
            continue
        if isinstance(v, str) and v:
            if PERSON_KEYS.match(k):
                out[k] = fake_name(v); continue
            if k.lower() == 'name' and looks_person:
                out[k] = fake_name(v); continue
            if EMAIL_KEYS.search(k):
                out[k] = fake_email(v); continue
            if PHONE_KEYS.search(k):
                out[k] = fake_phone(v); continue
            if DROP_KEYS.match(k):
                out[k] = None if k.lower().startswith(('avatar', 'photo', 'picture', 'profile_picture')) else ''
                continue
        if MONEY_KEYS.search(k):
            out[k] = _money(v); continue
        out[k] = v
    return out

def rewrite(url: str, body: bytes) -> bytes:
    data = json.loads(body.decode('utf-8'))
    data = walk(data, bool(PERSON_TABLES.search(url)))
    return json.dumps(data, ensure_ascii=False).encode('utf-8')

# Segunda camada, já na página: qualquer telefone/e-mail que escapar vira fictício.
DOM_SCRIPT = r"""
(() => {
  const phone = /(\+?55\s?)?\(?\d{2}\)?\s?9?\s?\d{4}[-\s]?\d{4}/g;
  const mail = /[\w.+-]+@[\w-]+\.[\w.]+/g;
  const fix = s => s.replace(mail, m => m.endsWith('@exemplo.com') ? m : 'contato@exemplo.com')
                    .replace(phone, m => /^\(82\) 9\d{4}-\d{4}$/.test(m) ? m : '(82) 99999-0000');
  const run = root => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) { const t = n.nodeValue; if (t && (t.includes('@') || /\d{4}/.test(t))) { const f = fix(t); if (f !== t) n.nodeValue = f; } }
    root.querySelectorAll && root.querySelectorAll('input,textarea').forEach(el => { if (el.value && (el.value.includes('@') || /\d{4}/.test(el.value))) { const f = fix(el.value); if (f !== el.value) el.value = f; } });
    root.querySelectorAll && root.querySelectorAll('img').forEach(img => { const s = img.getAttribute('src') || ''; if (/avatar|team|member|client|profile/i.test(s) && !/brand|logo/i.test(s)) img.style.visibility = 'hidden'; });
  };
  const start = () => { run(document.body); new MutationObserver(ms => ms.forEach(m => { if (m.type === 'characterData') { const t = m.target.nodeValue, f = fix(t || ''); if (f !== t) m.target.nodeValue = f; } else m.addedNodes.forEach(x => x.nodeType === 1 ? run(x) : (x.nodeType === 3 && x.nodeValue && (x.nodeValue = fix(x.nodeValue)))); })).observe(document.body, {subtree: true, childList: true, characterData: true}); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
"""

def install(context):
    """Liga a troca de dados num contexto do Playwright."""
    def handler(route):
        req = route.request
        try:
            resp = route.fetch()
        except Exception:
            return route.abort()
        ctype = resp.headers.get('content-type', '')
        if 'json' in ctype:
            try:
                body = rewrite(req.url, resp.body())
                return route.fulfill(response=resp, body=body)
            except Exception:
                return route.fulfill(response=resp, body=b'[]' if req.url.find('/rest/v1/') > 0 else b'{}')
        if '/storage/v1/object/' in req.url and re.search(r'(avatar|team|member|client|profile|barber)', req.url, re.I):
            return route.abort()
        return route.fulfill(response=resp)
    context.route(re.compile(r'https://oyjiiqbsbshfdgdaxbus\.supabase\.co/(rest|storage|functions)/.*'), handler)
    context.route(re.compile(r'https://sistemadebarbearia\.com\.br/api/.*'), handler)
    context.add_init_script(DOM_SCRIPT)
