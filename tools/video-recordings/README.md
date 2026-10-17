# Gravações de tela narradas (páginas de soluções e blog)

Gera os vídeos de `public/marketing/videos/` (um por função de cada solução).

- `s_*.py`: roteiro de cada solução (frases da narração + passos na tela).
- `record.py s_agenda [agenda-1 ...]`: grava com Playwright, sincronizando cada passo com a frase narrada.
- `build.py <id>|all`: monta abertura, gravação com legenda e encerramento (MP4 + capa JPG).
- `tts.py`: narração com a voz do site (ElevenLabs), com cache por frase.
- `mask.py`: troca nomes, telefones, e-mails, fotos e observações de clientes por dados fictícios
  nas respostas da API antes de chegarem à tela, e multiplica valores em dinheiro por um fator fixo.
- `common.py`: bloqueia qualquer escrita no banco durante a gravação (nada é salvo).

Precisa de um login de administrador temporário na barbearia gravada (senha em `.rec_pw`, fora do repositório)
e da chave da ElevenLabs em `.el_key`. Apague o login ao terminar.
Depois de gerar, rode `python3 build.py all`, copie `out/*.mp4|jpg` para `public/marketing/videos/`
e gere a versão WebM de cada vídeo (fallback do player).
