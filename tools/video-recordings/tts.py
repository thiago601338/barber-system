"""Narração com a voz do site (ElevenLabs), uma frase por arquivo.
Guarda em cache: o mesmo texto nunca é gerado duas vezes."""
import hashlib, json, os, subprocess, urllib.request

KEY = open('/home/claude/videos/.el_key').read().strip()
VOICE = 'RGymW84CSmfVugnA5tvA'
CACHE = '/home/claude/videos/audio'
os.makedirs(CACHE, exist_ok=True)

def duration(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).decode())

def say(text, prev=None, nxt=None):
    text = text.strip()
    h = hashlib.sha1((VOICE + '|v2|' + text).encode()).hexdigest()[:16]
    mp3 = f'{CACHE}/{h}.mp3'
    if not os.path.exists(mp3):
        payload = {'text': text, 'model_id': 'eleven_multilingual_v2',
                   'voice_settings': {'stability': 0.5, 'similarity_boost': 0.8, 'style': 0.15, 'use_speaker_boost': True, 'speed': 1.0}}
        if prev: payload['previous_text'] = prev
        if nxt: payload['next_text'] = nxt
        req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_128',
                                     data=json.dumps(payload).encode(), headers={'xi-api-key': KEY, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=180) as r:
            open(mp3 + '.part', 'wb').write(r.read())
        # corta silêncio do começo e do fim para o encaixe ficar justo
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', mp3 + '.part', '-af',
                        'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse',
                        '-c:a', 'libmp3lame', '-b:a', '128k', mp3], check=True)
        os.remove(mp3 + '.part')
    return mp3, duration(mp3)

def narrate(sentences):
    out = []
    for i, s in enumerate(sentences):
        out.append(say(s, sentences[i - 1] if i else None, sentences[i + 1] if i + 1 < len(sentences) else None))
    return out
