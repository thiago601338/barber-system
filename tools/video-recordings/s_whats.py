from common import *
from datetime import datetime, timedelta, timezone

L = 'WhatsApp com IA'
NOW = datetime(2026, 10, 17, 14, 20, tzinfo=timezone(timedelta(hours=-3)))
iso = lambda m: (NOW - timedelta(minutes=m)).isoformat()

CONN = {'barbershop_id': KINGSMAN, 'waba_id': '000000000000000', 'phone_number_id': '000000000000001',
        'display_phone_number': '+55 82 99999-0000', 'verified_name': 'Barbearia Kingsman', 'coexistence': True,
        'status': 'connected', 'ai_enabled': True, 'ai_can_book': True, 'human_pause_minutes': 60, 'last_error': None,
        'ai_instructions': 'Atenda de forma descontraída e chame o cliente pelo nome.\nAceitamos Pix, cartão e dinheiro.\nTolerância de 10 minutos de atraso.',
        'connected_at': iso(60 * 24 * 3)}
CONVS = [
 {'id': 'c1', 'wa_id': '5582999990001', 'contact_name': 'Lucas Almeida', 'last_message_at': iso(2), 'last_message_preview': 'Fechado! Te vejo amanhã às 14:40 com o Lorenzo.', 'last_customer_message_at': iso(3), 'ai_paused_until': None, 'unread_count': 0},
 {'id': 'c2', 'wa_id': '5582999990002', 'contact_name': 'Pedro Rocha', 'last_message_at': iso(18), 'last_message_preview': 'Quanto fica corte e barba?', 'last_customer_message_at': iso(18), 'ai_paused_until': None, 'unread_count': 1},
 {'id': 'c3', 'wa_id': '5582999990003', 'contact_name': 'Gabriel Nunes', 'last_message_at': iso(55), 'last_message_preview': 'Vocês abrem no feriado?', 'last_customer_message_at': iso(56), 'ai_paused_until': iso(-30), 'unread_count': 0},
 {'id': 'c4', 'wa_id': '5582999990004', 'contact_name': 'Rafael Duarte', 'last_message_at': iso(130), 'last_message_preview': 'Perfeito, obrigado!', 'last_customer_message_at': iso(131), 'ai_paused_until': None, 'unread_count': 0},
]
DIALOG = [
 ('in', 'customer', 'Oi! Tem horário amanhã à tarde pra corte?', 9),
 ('out', 'ai', 'Oi, Lucas! Tenho sim 😊 Amanhã à tarde estão livres 14:00, 14:40 e 16:40. Prefere algum barbeiro?', 8),
 ('in', 'customer', 'Pode ser 14:40 com o Lorenzo', 5),
 ('out', 'ai', 'Fechado! Reservei corte masculino amanhã às 14:40 com o Lorenzo. Qualquer coisa é só chamar por aqui.', 4),
 ('in', 'customer', 'Show, valeu!', 3),
 ('out', 'ai', 'Fechado! Te vejo amanhã às 14:40 com o Lorenzo.', 2),
]
DIALOG2 = [
 ('in', 'customer', 'Boa tarde! Quanto fica corte e barba?', 19),
 ('out', 'ai', 'Boa tarde, Pedro! Corte + barba sai por R$ 87,15 e leva uns 60 minutos. Quer que eu veja um horário?', 18),
 ('in', 'customer', 'Quero, mas queria falar com o Lorenzo antes', 17),
]
def msgs(dialog):
    return [{'id': f'm{i}', 'direction': d, 'author': a, 'kind': 'text', 'body': b, 'status': 'read' if d == 'out' else None, 'created_at': iso(m)} for i, (d, a, b, m) in enumerate(dialog)][::-1]
MSGS = msgs(DIALOG)
TEMPLATES = [
 {'id': 't1', 'name': 'confirmacao_agendamento', 'status': 'APPROVED', 'category': 'UTILITY', 'language': 'pt_BR', 'body': 'Olá {{1}}, seu horário na barbearia está confirmado para {{2}}.'},
 {'id': 't2', 'name': 'lembrete_horario', 'status': 'APPROVED', 'category': 'UTILITY', 'language': 'pt_BR', 'body': 'Oi {{1}}! Passando para lembrar do seu horário {{2}}. Até lá!'},
]

def extra(req):
    u = req.url
    if '/rest/v1/whatsapp_connections' in u: return CONN
    if '/rest/v1/whatsapp_conversations' in u: return CONVS
    if '/rest/v1/whatsapp_messages' in u: return msgs(DIALOG2) if 'eq.c2' in u else MSGS
    if '/api/whatsapp/templates' in u: return {'templates': TEMPLATES}
    if '/api/whatsapp/template-create' in u: return {'ok': True}
    if '/api/whatsapp/pause' in u:
        CONVS[1]['ai_paused_until'] = iso(-60); return {'ok': True, 'ai_paused_until': CONVS[1]['ai_paused_until']}
    if '/api/whatsapp/resume' in u:
        CONVS[1]['ai_paused_until'] = None; return {'ok': True}
    return None

def extra_disconnected(req):
    if '/rest/v1/whatsapp_connections' in req.url: return None
    return None

def go(d): d.nav('whatsapp', 2200)

def w1_0(d): d.hover(d.pg.get_by_text('Conecte o WhatsApp da barbearia').first, 900)
def w1_1(d):
    d.hover(d.pg.get_by_text('Usar o número que já tenho no WhatsApp Business').first, 1400)
def w1_2(d):
    d.hover(d.pg.get_by_text('Conectar um número novo').first, 1300)
def w1_3(d):
    d.hover(d.pg.get_by_text('A IA só responde quando o cliente escre').first, 1500)

def ask(d, text):
    box = d.pg.get_by_placeholder('Mensagem do cliente').first
    d.scroll_to(box, 500)
    d.type(box, text, delay=45, after=300)
    d.click(d.pg.get_by_role('button', name='Testar').first, 400)
    try:
        d.pg.wait_for_function('() => !document.body.innerText.includes("Pensando")', timeout=25000)
    except Exception:
        pass
    d.wait(4200)

def w2_0(d): d.scroll_to(d.pg.get_by_text('Testar a IA').first, 900, block='start')
def w2_1(d): ask(d, 'Oi! Quanto custa o corte masculino?')
def w2_2(d): ask(d, 'E vocês aceitam Pix?')

def w3_0(d): d.scroll_to(d.pg.get_by_text('Conversas').first, 900, block='start')
def w3_1(d): d.click(d.pg.get_by_text('Lucas Almeida').first, 1600)
def w3_2(d): d.hover(d.pg.get_by_text('Fechado! Reservei corte masculino').first, 2200)

def w4_0(d): d.scroll_to(d.pg.get_by_text('Como a IA atende').first, 900, block='start')
def w4_1(d):
    ta = d.pg.locator('textarea').first
    d.click(ta, 200); ta.press('End'); ta.press_sequentially('\nTemos estacionamento na rua lateral.', delay=40); d.wait(500)
def w4_2(d):
    d.hover(d.pg.get_by_text('Atendimento por IA').first, 1500)

def w5_0(d):
    d.scroll_to(d.pg.get_by_text('Conversas').first, 700, block='start')
    d.click(d.pg.get_by_text('Pedro Rocha').first, 1400)
def w5_1(d):
    d.click(d.pg.get_by_role('button', name='Assumir conversa').first, 1200)
    box = d.pg.locator('[placeholder*="Responder como equipe"]').first
    d.type(box, 'Oi Pedro, aqui é o Lorenzo! Te espero amanhã, pode marcar.', delay=40)
def w5_2(d):
    d.hover(d.pg.get_by_role('button', name='Devolver para a IA').first, 1600)

def w6_0(d): d.scroll_to(d.pg.get_by_text('Modelos de mensagem').first, 900, block='start')
def w6_1(d):
    d.hover(d.pg.get_by_text('confirmacao_agendamento').first, 1300)
def w6_2(d):
    name = d.pg.get_by_placeholder('confirmacao_agendamento').first
    d.type(name, 'retorno_cliente', delay=55)
    body = d.pg.get_by_placeholder('Olá {{1}}, seu horário na barbearia está confirmado para {{2}}.').first
    d.type(body, 'Oi {{1}}! Faz um tempo que você não aparece. Que tal marcar seu corte {{2}}?', delay=30)

SCRIPTS = [
 {'id': 'whatsapp-1', 'label': L, 'title': 'Conecte o WhatsApp da barbearia', 'setup': go, 'extra': extra_disconnected,
  'narration': ['Na aba WhatsApp com IA, a barbearia conecta o próprio número.',
                'Dá para usar o número que você já tem no WhatsApp Business e continuar respondendo pelo celular.',
                'Ou conectar um número novo, só para o atendimento.',
                'A conexão é pela API oficial da Meta, e a IA só responde quando o cliente escreve primeiro.'],
  'acts': [w1_0, w1_1, w1_2, w1_3]},
 {'id': 'whatsapp-2', 'label': L, 'title': 'Preços e serviços na hora', 'setup': go, 'extra': extra,
  'narration': ['Antes de ligar, você pode testar a IA aqui mesmo.',
                'Ela já conhece os serviços e os preços da barbearia.',
                'E responde as dúvidas do dia a dia, do jeito que você configurou.'],
  'acts': [w2_0, w2_1, w2_2]},
 {'id': 'whatsapp-3', 'label': L, 'title': 'Agenda direto pela conversa', 'setup': go, 'extra': extra,
  'narration': ['Todas as conversas ficam reunidas no painel.',
                'Aqui, o cliente pediu um horário para amanhã à tarde.',
                'A IA consultou a agenda, ofereceu as vagas livres e já deixou a reserva feita.'],
  'acts': [w3_0, w3_1, w3_2]},
 {'id': 'whatsapp-4', 'label': L, 'title': 'Do seu jeito de atender', 'setup': go, 'extra': extra,
  'narration': ['Em Como a IA atende, você escreve as regras da casa.',
                'Tom de voz, formas de pagamento, atraso, estacionamento.',
                'E liga ou desliga o atendimento automático quando quiser.'],
  'acts': [w4_0, w4_1, w4_2]},
 {'id': 'whatsapp-5', 'label': L, 'title': 'A equipe assume quando precisar', 'setup': go, 'extra': extra,
  'narration': ['Quer responder você mesmo? Abra a conversa.',
                'Clique em assumir conversa e escreva. A IA pausa naquele atendimento.',
                'Quando terminar, devolva para a IA continuar.'],
  'acts': [w5_0, w5_1, w5_2]},
 {'id': 'whatsapp-6', 'label': L, 'title': 'Modelos de mensagem', 'setup': go, 'extra': extra,
  'narration': ['Em Modelos de mensagem ficam os textos aprovados pela Meta.',
                'Como a confirmação de horário e o lembrete.',
                'Para criar um novo, dê um nome, escreva o texto e envie para aprovação.'],
  'acts': [w6_0, w6_1, w6_2]},
]
