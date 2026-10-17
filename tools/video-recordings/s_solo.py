from common import *

L = 'Barbeiro independente'

def s1_0(d): d.hover(d.pg.get_by_text('Olá').first, 900)
def s1_1(d):
    for k in ['appointments', 'clients', 'services']:
        d.hover(d.pg.locator(f'[data-tour-nav="{k}"]'), 500)
    d.hover(d.pg.locator('[data-tour-nav="finance"]'), 600)
def s1_2(d):
    d.nav('settings', 1600)
    d.hover(d.pg.get_by_text('Dados da barbearia').first, 900)

def s2_0(d): d.nav('appointments', 1600)
def s2_1(d):
    d.nav('services', 1500)
    d.scroll_to(d.pg.get_by_text('Bloqueios de período').first, 700)
    d.click(d.pg.get_by_role('button', name='Bloquear período'), 900)
def s2_2(d):
    d.type(d.modal().locator('textarea').first, 'Buscar meu filho na escola', delay=45)
    d.hover(d.modal().locator('button').last, 900)

def s3_0(d): d.hover(d.pg.locator('table tbody tr').first, 700)
def s3_1(d):
    d.click(d.pg.get_by_text('Abrir prontuário').first, 2200)
def s3_2(d):
    m = d.modal()
    ta = m.locator('textarea')
    if ta.count():
        d.type(ta.first, 'Prefere máquina 2 nas laterais e tesoura em cima. Gosta de café.', delay=35)
    else:
        d.scroll(500, after=1200)

def s4_0(d): d.hover(d.pg.get_by_text('Faturamento da equipe no mês').first, 900)
def s4_1(d):
    d.click(d.pg.get_by_text('Rendimento no mês').first, 2000)
def s4_2(d):
    m = d.modal()
    d.scroll_to(m.get_by_text('Para onde vai o faturamento').first, 1800, block='start')

def s5_0(d): d.click(d.pg.get_by_role('button', name='CRM e retorno', exact=True).first, 1500)
def s5_1(d): d.hover(d.pg.get_by_text('Sem visita há 90 dias').first, 900); d.hover(d.pg.get_by_text('Aniversários no período').first, 900)
def s5_2(d): d.click(d.pg.get_by_role('button', name='Fidelidade e indicação', exact=True).first, 1300); d.click(d.pg.get_by_role('button', name='Política de pontos', exact=True).first, 1500)

def s6_0(d): d.hover(d.pg.locator('.phone-shell, [class*=phone], [class*=preview]').first, 1000)
def s6_1(d):
    d.pg.goto(BASE + '/b/kingsman'); d.pg.wait_for_selector('text=Agendar procedimento', timeout=40000); d.wait(800); d._ensure_cursor()
    d.hover(d.pg.get_by_text('Agendar procedimento').first, 900)
def s6_2(d): d.scroll(700, after=1200)

SCRIPTS = [
 {'id': 'autonomo-1', 'label': L, 'title': 'Você no controle do seu negócio', 'setup': lambda d: d.nav('dashboard', 2500),
  'narration': ['Quem trabalha por conta própria entra como administrador.',
                'Agenda, clientes, serviços e financeiro ficam todos liberados.',
                'E as configurações da barbearia também são suas.'],
  'acts': [s1_0, s1_1, s1_2]},
 {'id': 'autonomo-2', 'label': L, 'title': 'Sua rotina cabe na agenda', 'setup': lambda d: d.nav('dashboard', 1500),
  'narration': ['Sua agenda mostra os atendimentos do dia.',
                'Precisa sair mais cedo? Bloqueie o período em Serviços.',
                'Aquele horário deixa de aparecer como vaga para o cliente.'],
  'acts': [s2_0, s2_1, s2_2]},
 {'id': 'autonomo-3', 'label': L, 'title': 'Lembre como seu cliente gosta', 'setup': lambda d: d.nav('clients', 2200),
  'narration': ['Em Clientes, cada pessoa tem o seu prontuário.',
                'Abra para ver o histórico de atendimentos.',
                'E anote as preferências para consultar na próxima visita.'],
  'acts': [s3_0, s3_1, s3_2]},
 {'id': 'autonomo-4', 'label': L, 'title': 'O dia rendeu. E o dinheiro?', 'setup': lambda d: d.nav('barbers', 2200),
  'narration': ['Em Barbeiros, você vê o faturamento do mês.',
                'Clique no profissional para abrir os rendimentos.',
                'Faturamento, comissão, custos e o que sobra, mês a mês, em gráfico.'],
  'acts': [s4_0, s4_1, s4_2]},
 {'id': 'autonomo-5', 'label': L, 'title': 'Dê atenção a quem já atende com você', 'setup': lambda d: d.nav('clients', 2200),
  'narration': ['Em CRM e retorno, aparecem os clientes que merecem um contato.',
                'Quem está sem visita há um tempo e quem faz aniversário.',
                'Em Fidelidade e indicação, você monta a política de pontos e benefícios.'],
  'acts': [s5_0, s5_1, s5_2]},
 {'id': 'autonomo-6', 'label': L, 'title': 'Seu trabalho merece ser encontrado', 'setup': lambda d: d.nav('bio', 2200),
  'narration': ['A Mini bio já vem pronta com a sua marca.',
                'O link leva para a página com seus serviços e o agendamento.',
                'É só compartilhar com seus clientes.'],
  'acts': [s6_0, s6_1, s6_2]},
]
