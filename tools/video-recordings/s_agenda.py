from common import *

L = 'Agenda online'
SUB = '2d77058a-fd2b-4deb-9787-f50d6ee97297'  # cliente assinante (nome trocado na tela)

def slots_extra(req):
    if '/rpc/available_slots' in req.url:
        return fake_slots()
    return None

def svc_panel(d):
    return d.pg.get_by_text('Duração, preparo e recursos').first

def a1_0(d):
    d.hover(d.pg.locator('table tbody tr').first.locator('td').nth(1), 900)
def a1_1(d):
    d.scroll_to(svc_panel(d), 900)
    sel = d.pg.locator('.schedule-settings select').nth(0)
    d.select(sel, label='corte masculino', after=700)
    d.select(d.pg.locator('.schedule-settings select').nth(1), index=2, after=900)
def a1_2(d):
    inp = d.pg.locator('.schedule-settings input[type=number]').nth(0)
    d.click(inp, 200); inp.fill(''); inp.press_sequentially('35', delay=120); d.wait(500)
    inp2 = d.pg.locator('.schedule-settings input[type=number]').nth(2)
    d.click(inp2, 200); inp2.fill(''); inp2.press_sequentially('10', delay=120); d.wait(600)
def a1_3(d):
    d.hover(d.pg.get_by_role('button', name='Salvar configuração'), 1500)

def a2_0(d):
    d.scroll_to(d.pg.get_by_text('Disponibilidade da equipe').first, 900)
def a2_1(d):
    d.click(d.pg.get_by_role('button', name='Adicionar horário'), 1000)
    m = d.modal(); d.select(m.locator('select').nth(0), index=2, after=500); d.select(m.locator('select').nth(1), label='Sábado', after=500)
def a2_2(d):
    d.close_modal(); d.scroll_to(d.pg.get_by_text('Folgas e horários especiais').first, 700)
    d.click(d.pg.get_by_role('button', name='Nova exceção'), 900)
    d.select(d.modal().locator('select').first, index=3, after=500)
def a2_3(d):
    d.close_modal(); d.scroll_to(d.pg.get_by_text('Bloqueios de período').first, 700)
    d.click(d.pg.get_by_role('button', name='Bloquear período'), 900)
    d.type(d.modal().locator('textarea').first, 'Consulta médica no fim da tarde', delay=45)

def a3_0(d):
    d.scroll_to(d.pg.get_by_text('Recursos compartilhados').first, 900)
def a3_1(d):
    d.click(d.pg.get_by_role('button', name='Novo recurso'), 900)
    m = d.modal(); d.type(m.locator('input').nth(0), 'Lavatório', delay=70)
    n = m.locator('input[type=number]').first; d.click(n, 200); n.fill(''); n.press_sequentially('2', delay=150); d.wait(500)
def a3_2(d):
    d.hover(d.modal().get_by_role('button', name='Salvar recurso'), 900); d.close_modal()
    d.scroll_to(svc_panel(d), 700)
    d.select(d.pg.locator('.schedule-settings select').nth(0), label='corte masculino', after=700)
    d.hover(d.pg.get_by_text('Recursos necessários').first, 900)

def a4_0(d):
    d.hover(d.text('Agenda', exact=True).last, 900)
def a4_1(d):
    d.click(d.text('Lista de espera').first, 1200)
    d.click(d.text('Adicionar cliente').first, 1000)
def a4_2(d):
    m = d.modal()
    sels = m.locator('select')
    if sels.count():
        d.select(sels.nth(0), index=5, after=500)
    if sels.count() > 1:
        d.select(sels.nth(1), index=2, after=500)
    d.hover(m.locator('button').last, 900)

def a5_0(d):
    d.scroll_to(d.pg.get_by_text('Confirmação, prazos e sinal').first, 900)
def a5_1(d):
    sec = d.pg.locator('form').filter(has_text='Antecedência para cancelar').last
    i1 = sec.locator('input[type=number]').nth(0); d.click(i1, 200); i1.fill(''); i1.press_sequentially('12', delay=140); d.wait(400)
    i2 = sec.locator('input[type=number]').nth(1); d.click(i2, 200); i2.fill(''); i2.press_sequentially('6', delay=140); d.wait(400)
def a5_2(d):
    sec = d.pg.locator('form').filter(has_text='Antecedência para cancelar').last
    d.click(sec.locator('input[type=checkbox]').first, 600)
    d.hover(sec.get_by_role('button', name='Salvar regras'), 900)

def a6_0(d):
    d.click(d.pg.get_by_role('button', name='Novo agendamento'), 1200)
def a6_1(d):
    m = d.modal()
    d.select(m.locator('select').nth(0), value=SUB, after=600)
    d.select(m.locator('select').nth(1), index=2, after=600)
    d.click(m.get_by_text('corte masculino', exact=True).first, 700)
def a6_2(d):
    m = d.modal()
    dt = m.locator('input[type=date]').first
    d.scroll_to(dt, 500); d.click(dt, 200); dt.fill('2026-10-19'); d.wait(1500)
    d.click(m.locator('button.slot').nth(1), 1200)
def a6_3(d):
    m = d.modal()
    d.scroll_to(m.get_by_text('Cobertura da assinatura').first, 900)
    sel = m.locator('.booking-eligibility select')
    if sel.count() and sel.first.locator('option').count() > 1:
        d.select(sel.first, index=1, after=1800)

SCRIPTS = [
 {'id': 'agenda-1', 'label': L, 'setup': lambda d: d.nav('services', 1800), 'title': 'Cada barbeiro tem seu tempo',
  'narration': ['Cada barbeiro trabalha no seu ritmo.',
                'Em Serviços, escolha o procedimento e o profissional.',
                'Ajuste a duração e o tempo de preparo só para ele.',
                'A agenda passa a reservar exatamente esse tempo.'],
  'acts': [a1_0, a1_1, a1_2, a1_3]},
 {'id': 'agenda-2', 'label': L, 'setup': lambda d: d.nav('services', 1800), 'title': 'Folga também entra na agenda',
  'narration': ['Os dias e horários de cada barbeiro ficam cadastrados aqui.',
                'Dá para adicionar um horário semanal, como o sábado de um profissional.',
                'Folgas e jornadas diferentes entram como exceção do dia.',
                'E um compromisso pessoal vira um bloqueio, que não aparece como vaga para o cliente.'],
  'acts': [a2_0, a2_1, a2_2, a2_3]},
 {'id': 'agenda-3', 'label': L, 'setup': lambda d: d.nav('services', 1800), 'title': 'Vai precisar do mesmo equipamento?',
  'narration': ['Lavatório, cadeira especial, equipamento de química: tudo isso pode virar um recurso.',
                'Você informa o nome e quantas unidades a barbearia tem.',
                'Depois, liga o recurso ao serviço, e a agenda só oferece o horário quando ele está livre.'],
  'acts': [a3_0, a3_1, a3_2]},
 {'id': 'agenda-4', 'label': L, 'setup': lambda d: d.nav('appointments', 1800), 'title': 'Quem está esperando uma vaga?',
  'narration': ['O cliente queria um horário que já estava ocupado?',
                'Coloque ele na lista de espera, com o dia, o período e o barbeiro que prefere.',
                'Quando abrir uma vaga, você oferece, e a reserva só entra na agenda depois que ele aceitar.'],
  'acts': [a4_0, a4_1, a4_2]},
 {'id': 'agenda-5', 'label': L, 'setup': lambda d: d.nav('services', 1800), 'title': 'Precisou mudar o horário?',
  'narration': ['As regras de cancelamento e remarcação ficam no fim da página de serviços.',
                'Defina com quantas horas de antecedência o cliente pode cancelar ou remarcar.',
                'Se quiser, peça também a confirmação de presença. A área do cliente segue essas regras.'],
  'acts': [a5_0, a5_1, a5_2]},
 {'id': 'agenda-6', 'label': L, 'setup': lambda d: d.nav('appointments', 1800), 'title': 'O atendimento está no plano?',
  'narration': ['Num novo agendamento, escolha o cliente, o barbeiro e o serviço.',
                'Depois, o dia e uma das vagas livres.',
                'O sistema confere na hora se o serviço faz parte da assinatura e quantos usos ainda restam.'],
  'acts': [a6_0, a6_1, lambda d: (a6_2(d), a6_3(d))], 'extra': slots_extra},
]
