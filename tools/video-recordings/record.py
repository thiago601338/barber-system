"""Grava a tela de um roteiro, sincronizando cada passo com a frase narrada.
Uso: python3 record.py modulo [id ...]"""
import glob, importlib, shutil, sys, time, json
from common import *
import tts

RAW = '/home/claude/videos/raw'
os.makedirs(RAW, exist_ok=True)

GAP = 0.35

def record(spec, p):
    vid = spec['id']
    clips = tts.narrate(spec['narration'])
    tmp = f'{RAW}/{vid}_tmp'
    shutil.rmtree(tmp, ignore_errors=True)
    b, ctx = new_context(p, record_dir=tmp, extra=spec.get('extra'), viewport=spec.get('viewport', VIEW))
    born = time.time()
    pg = ctx.new_page(); d = Director(pg)
    pg.goto(BASE + spec.get('url', '/app'))
    if spec.get('wait_for'):
        pg.wait_for_selector(spec['wait_for'], timeout=40000)
    elif spec.get('url', '/app').startswith('/app'):
        pg.wait_for_selector('[data-tour-nav]', timeout=40000)
    pg.wait_for_timeout(1000)
    if spec.get('setup'):
        spec['setup'](d)
    d._ensure_cursor()
    pg.wait_for_timeout(500)
    t0 = time.time()
    errors, starts = [], []
    speech_free = 0.0  # quando a fala anterior termina (relativo a t0)
    for i, act in enumerate(spec['acts']):
        now = time.time() - t0
        st = max(now, speech_free + (GAP if i else 0))
        if st > now:
            pg.wait_for_timeout(int((st - now) * 1000))
        starts.append(st)
        if i < len(clips):
            speech_free = st + clips[i][1]
        try:
            act(d)
        except Exception as e:
            errors.append(f'passo {i}: {str(e)[:160]}')
    end = max(time.time() - t0, speech_free) + spec.get('tail', 1.2)
    now = time.time() - t0
    if end > now:
        pg.wait_for_timeout(int((end - now) * 1000))
    offset = t0 - born
    ctx.close(); b.close()
    webm = glob.glob(f'{tmp}/*.webm')[0]
    shutil.move(webm, f'{RAW}/{vid}.webm'); shutil.rmtree(tmp, ignore_errors=True)
    json.dump({'offset': offset, 'dur': end, 'clips': [c[0] for c in clips], 'clip_durs': [c[1] for c in clips], 'starts': starts,
               'narration': spec['narration'], 'title': spec['title'], 'label': spec['label'], 'subtitle': spec.get('subtitle'),
               'errors': errors}, open(f'{RAW}/{vid}.json', 'w'), ensure_ascii=False)
    print(vid, f'{end:.1f}s', 'ERROS:' if errors else 'ok', *errors)

if __name__ == '__main__':
    mod = importlib.import_module(sys.argv[1])
    only = set(sys.argv[2:])
    with sync_playwright() as p:
        if not os.path.exists(STATE):
            login(p)
        for spec in mod.SCRIPTS:
            if only and spec['id'] not in only:
                continue
            record(spec, p)
