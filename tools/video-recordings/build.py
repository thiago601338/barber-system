"""Monta o vídeo final: abertura, gravação com narração e legenda, encerramento.
Uso: python3 build.py id [id ...]   (ou 'all')"""
import glob, json, os, re, subprocess, sys, textwrap
from PIL import Image, ImageDraw, ImageFont, ImageFilter

RAW = '/home/claude/videos/raw'
OUT = '/home/claude/videos/out'
os.makedirs(OUT, exist_ok=True)
W, H = 1280, 800
INTRO, OUTRO, XF = 2.4, 2.6, 0.45
ACCENT, INK, PAPER, MUTED = (172, 73, 47), (29, 28, 36), (255, 252, 248), (121, 113, 119)
LOGO = '/home/claude/barber-system/public/brand/barber-system-logo.png'
F = lambda w, s: ImageFont.truetype(f'/usr/share/fonts/opentype/inter/Inter-{w}.otf', s)

def card(path, eyebrow, title, sub=None, outro=False):
    im = Image.new('RGB', (W, H), PAPER)
    dr = ImageDraw.Draw(im)
    # aura suave
    glow = Image.new('RGB', (W, H), PAPER); gd = ImageDraw.Draw(glow)
    gd.ellipse((W - 520, -260, W + 260, 520), fill=(244, 222, 210)); gd.ellipse((-300, H - 300, 380, H + 300), fill=(247, 236, 226))
    im = Image.blend(im, glow.filter(ImageFilter.GaussianBlur(120)), 0.9); dr = ImageDraw.Draw(im)
    logo = Image.open(LOGO).convert('RGBA'); lw = 250 if not outro else 420
    logo = logo.resize((lw, int(logo.height * lw / logo.width)))
    if outro:
        im.paste(logo, ((W - lw) // 2, 250), logo)
        f1, f2 = F('SemiBold', 40), F('Medium', 26)
        t = title; tw = dr.textlength(t, font=f1); dr.text(((W - tw) / 2, 430), t, font=f1, fill=INK)
        tw = dr.textlength(sub, font=f2); dr.text(((W - tw) / 2, 495), sub, font=f2, fill=ACCENT)
    else:
        im.paste(logo, (90, H - 90 - logo.height), logo)
        dr.rounded_rectangle((90, 190, 96, 236), 3, fill=ACCENT)
        dr.text((116, 196), eyebrow.upper(), font=F('Bold', 22), fill=ACCENT, spacing=4)
        f = F('Bold', 64); lines = textwrap.wrap(title, 30)
        y = 270
        for ln in lines:
            dr.text((90, y), ln, font=f, fill=INK); y += 78
        if sub:
            for ln in textwrap.wrap(sub, 62):
                dr.text((92, y + 18), ln, font=F('Regular', 28), fill=MUTED); y += 40
    im.save(path)

def ass_time(t):
    t = max(0, t); h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f'{h}:{m:02d}:{s:05.2f}'

def chunks(sentence, maxlen=74):
    words = sentence.split()
    n = max(1, -(-len(sentence) // maxlen))
    target = len(sentence) / n
    out, cur = [], ''
    for w in words:
        if cur and len(cur) + len(w) + 1 > target * 1.12 and len(out) < n - 1:
            out.append(cur); cur = w
        else:
            cur = (cur + ' ' + w).strip()
    if cur: out.append(cur)
    return out

def subtitles(meta, path, shift):
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Leg,Inter SemiBold,31,&H00FFFFFF,&H00FFFFFF,&H00241C1D,&H33241C1D,0,0,0,0,100,100,0,0,3,14,0,2,120,120,38,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    for s, a, dd in zip(meta['narration'], meta['starts'], meta['clip_durs']):
        b = a + dd
        parts = chunks(s.strip())
        total = sum(len(p) for p in parts)
        t = a
        for p in parts:
            d = (b - a) * len(p) / total
            ev.append(f'Dialogue: 0,{ass_time(t + shift)},{ass_time(t + d + shift + 0.05)},Leg,,0,0,0,,{p}')
            t += d
    open(path, 'w').write(head + '\n'.join(ev) + '\n')

def build(vid):
    meta = json.load(open(f'{RAW}/{vid}.json'))
    work = f'{RAW}/{vid}_build'; os.makedirs(work, exist_ok=True)
    card(f'{work}/intro.png', meta['label'], meta['title'], meta.get('subtitle'))
    card(f'{work}/outro.png', '', 'Conheça o Barber System', 'sistemadebarbearia.com.br', outro=True)
    body = meta['dur']
    shift = INTRO - XF  # quando a gravação começa no vídeo final
    subtitles(meta, f'{work}/leg.ass', shift)
    total = INTRO + body + OUTRO - 2 * XF
    out = f'{OUT}/{vid}.mp4'
    fc = (
        f"[0:v]scale={W}:{H},format=yuv420p,setsar=1,fps=30[i];"
        f"[1:v]trim=start={meta['offset']:.3f}:duration={body:.3f},setpts=PTS-STARTPTS,scale={W}:{H}:flags=lanczos,fps=30,format=yuv420p,setsar=1[r];"
        f"[2:v]scale={W}:{H},format=yuv420p,setsar=1,fps=30[o];"
        f"[i][r]xfade=transition=fade:duration={XF}:offset={INTRO - XF:.3f}[ir];"
        f"[ir][o]xfade=transition=fade:duration={XF}:offset={INTRO + body - 2 * XF:.3f}[v0];"
        f"[v0]ass={work}/leg.ass[v];"
        + ''.join(f"[{3 + k}:a]aresample=44100,adelay={int((shift + st) * 1000)}|{int((shift + st) * 1000)}[c{k}];" for k, st in enumerate(meta['starts'][:len(meta['clips'])]))
        + ''.join(f"[c{k}]" for k in range(len(meta['clips']))) + f"amix=inputs={len(meta['clips'])}:normalize=0,apad,atrim=0:{total:.3f},afade=t=out:st={total - 0.8:.3f}:d=0.8[a]"
    )
    cmd = ['ffmpeg', '-y', '-loglevel', 'error',
           '-loop', '1', '-t', f'{INTRO}', '-i', f'{work}/intro.png',
           '-i', f'{RAW}/{vid}.webm',
           '-loop', '1', '-t', f'{OUTRO}', '-i', f'{work}/outro.png',
           *sum([['-i', c] for c in meta['clips']], []),
           '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
           '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-t', f'{total:.3f}', out]
    subprocess.run(cmd, check=True)
    # capa: um quadro da gravação no meio da narração
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{shift + meta["dur"] * 0.6:.2f}', '-i', out,
                    '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', f'{OUT}/{vid}.jpg'], check=True)
    size = os.path.getsize(out) / 1e6
    print(vid, f'{total:.1f}s', f'{size:.1f}MB')

if __name__ == '__main__':
    ids = sys.argv[1:]
    if ids == ['all']:
        ids = [os.path.basename(p)[:-5] for p in sorted(glob.glob(f'{RAW}/*.json'))]
    for v in ids:
        build(v)
