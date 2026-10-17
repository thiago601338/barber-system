from common import *
from datetime import datetime, timedelta

L = 'Área do cliente'
CID = '793c3fde-b7db-45c1-ab39-ad883244307f'  # cliente assinante (nome trocado)

def with_future(rows):
    """Acrescenta um próximo horário fictício à lista real (já com dados trocados)."""
    if not isinstance(rows, list) or not rows:
        return rows
    base = dict(rows[0])
    base.update({'id': '00000000-0000-4000-8000-000000000001', 'starts_at': '2026-10-21T15:20:00-03:00',
                 'ends_at': '2026-10-21T16:00:00-03:00', 'status': 'confirmed'})
    return [base] + rows if 'starts_at' in rows[0] else rows

def extra(req):
    u = req.url
    if '/rest/v1/memberships' in u and f'user_id=eq.{REC_UID}' in u: return []
    if '/rest/v1/clients' in u and f'user_id=eq.{REC_UID}' in u: return [{'id': CID, 'barbershop_id': KINGSMAN}]
    if '/rest/v1/appointments' in u and CID in u and req.method == 'GET': return with_future
    if '/rpc/available_slots' in u: return fake_slots('2026-10-23')
    return None

def view(d, name, after=1600):
    d.click(d.pg.get_by_role('button', name=name, exact=True).first, after)

def k1_0(d): d.hover(d.pg.get_by_text('Seus próximos horários').first, 1000)
def k1_1(d): view(d, 'Agenda')
def k1_2(d): d.hover(d.pg.get_by_text('Meus próximos atendimentos').first, 700); d.hover(d.pg.locator('table tbody tr, .data-table tr').first, 1500)

def k2_0(d): d.hover(d.pg.get_by_text('Visitas registradas').first, 900); d.hover(d.pg.get_by_text('Valor pago').first, 900)
def k2_1(d): view(d, 'Agenda'); d.scroll(600, after=900)
def k2_2(d): d.scroll(600, after=1300)

def k3_0(d): d.hover(d.pg.get_by_text('Usos restantes').first, 1000)
def k3_1(d): view(d, 'Assinatura')
def k3_2(d): d.scroll(450, after=1500)

def k4_0(d): d.hover(d.pg.get_by_text('Agendar procedimento').first, 800)
def k4_1(d): d.click(d.pg.get_by_text('Agendar procedimento').first, 2400)
def k4_2(d):
    pg = d.pg
    d.click(pg.get_by_text('corte masculino', exact=True).first, 600)
    d.scroll_to(pg.get_by_text('2. Profissional e data').first, 500, block='start')
    d.click(pg.get_by_text('Lorenzo Pinto').first, 500)
    dt = pg.locator('input[type=date]').first; d.click(dt, 200); dt.fill('2026-10-23'); d.wait(1400)
    d.scroll_to(pg.get_by_text('3. Horário disponível').first, 500, block='start')
    d.click(pg.locator('button.slot').nth(2), 1600)

def k5_0(d):
    d.pg.goto(BASE + '/b/kingsman'); d.pg.wait_for_timeout(3000); d._ensure_cursor()
    d.hover(d.pg.get_by_text('Ver produtos').first, 800)
def k5_1(d): d.click(d.pg.get_by_text('Ver produtos').first, 1600)
def k5_2(d): d.scroll(450, after=1300)

def k6_0(d): d.hover(d.pg.get_by_text('na sua tela inicial').first, 1200)
def k6_1(d): d.click(d.pg.get_by_role('button', name=re.compile('Adicionar à tela inicial')).first, 2000)
def k6_2(d):
    if d.pg.locator('[role=dialog], .modal').count():
        d.hover(d.modal(), 1600)
    else:
        d.wait(1500)

S = lambda: {'url': '/app?shop=kingsman', 'extra': extra, 'wait_for': '.client-portal, [class*=client]'}
SCRIPTS = [
 {'id': 'cliente-1', 'label': L, 'title': 'O próximo atendimento à mão', **S(),
  'narration': ['Esta é a área do seu cliente, com a cara da barbearia.',
                'Na Agenda, ele vê os próximos horários marcados.',
                'E pode confirmar, remarcar ou cancelar, dentro dos prazos que você definiu.'],
  'acts': [k1_0, k1_1, k1_2]},
 {'id': 'cliente-2', 'label': L, 'title': 'Quando veio e quanto gastou', **S(),
  'narration': ['Logo na entrada, o cliente vê quantas visitas fez e quanto já pagou.',
                'Mais abaixo, os atendimentos anteriores.',
                'Cada pessoa acessa só as informações da própria conta.'],
  'acts': [k2_0, k2_1, k2_2]},
 {'id': 'cliente-3', 'label': L, 'title': 'O que ainda pode usar no plano', **S(),
  'narration': ['Quem é assinante vê quantos usos ainda tem.',
                'Na aba Assinatura, ficam o plano, o ciclo e as condições contratadas.',
                'Se faltar confirmar um pagamento, isso aparece indicado.'],
  'acts': [k3_0, k3_1, k3_2]},
 {'id': 'cliente-4', 'label': L, 'title': 'Hora de marcar de novo', **S(),
  'narration': ['Quer voltar? É só tocar em agendar procedimento.',
                'O cliente escolhe o serviço e o barbeiro.',
                'E a agenda mostra as vagas livres para o novo horário.'],
  'acts': [k4_0, k4_1, k4_2]},
 {'id': 'cliente-5', 'label': L, 'title': 'Os produtos da barbearia por perto', **S(),
  'narration': ['Pela página da barbearia, o cliente também chega aos produtos.',
                'Pomadas, shampoos, óleos, com foto e preço.',
                'A compra e a retirada seguem o que a barbearia oferece.'],
  'acts': [k5_0, k5_1, k5_2]},
 {'id': 'cliente-6', 'label': L, 'title': 'Um atalho na tela do celular', **S(),
  'narration': ['No topo da área do cliente, aparece o convite para a tela inicial.',
                'Com um toque, ele adiciona a barbearia ao celular, como um aplicativo.',
                'Sem baixar nada na loja de aplicativos.'],
  'acts': [k6_0, k6_1, k6_2]},
]
