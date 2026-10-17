from common import *

L = 'Assinaturas'
def tab(d, name, after=1500):
    d.click(d.pg.get_by_role('button', name=name, exact=True).first, after)
def go(d): d.nav('subscriptions', 2200)

def c1_0(d): tab(d, 'Planos')
def c1_1(d): d.hover(d.pg.locator('table tbody tr').nth(1), 1400)
def c1_2(d):
    tab(d, 'Contratos')
    d.hover(d.pg.locator('table tbody tr').nth(1), 1500)

def c2_0(d): tab(d, 'Contratos'); d.hover(d.pg.locator('table thead th').filter(has_text='Uso').first, 1000)
def c2_1(d):
    d.click(d.pg.locator('table tbody tr').nth(1), 1800)
def c2_2(d):
    m = d.modal()
    try:
        d.scroll_to(m.get_by_text('Uso', exact=False).first, 1500)
    except Exception:
        d.wait(1500)

def c3_0(d): tab(d, 'Calendário e recebíveis')
def c3_1(d): d.hover(d.pg.locator('table tbody tr').first.locator('td').last, 1500)
def c3_2(d): d.hover(d.pg.locator('table tbody tr').nth(1).locator('td').last, 1500)

def c4_0(d): tab(d, 'Saúde dos planos'); d.hover(d.pg.get_by_text('Inadimplência').first, 1200)
def c4_1(d): d.click(d.pg.get_by_role('button', name=re.compile('^Inadimplentes')).first, 1500)
def c4_2(d): d.hover(d.pg.locator('table tbody tr').first, 1800)

def c5_0(d): d.hover(d.pg.get_by_text('Receita recorrente mensal').first, 1200)
def c5_1(d):
    d.hover(d.pg.get_by_text('Assinantes com ciclo ativo').first, 900)
    d.scroll(320, after=500)
def c5_2(d):
    d.hover(d.pg.get_by_text('Churn do período').first, 900)
    d.hover(d.pg.get_by_text('Margem de contribuição').first, 1100)

def c6_0(d): d.nav('settings', 1800)
def c6_1(d): d.hover(d.pg.get_by_text('Pagamento da barbearia').first, 900); d.hover(d.pg.get_by_text('Mercado Pago').first, 1200)
def c6_2(d): d.hover(d.pg.get_by_role('button', name=re.compile('Conectar Mercado Pago')).first, 1800)

SCRIPTS = [
 {'id': 'assinaturas-1', 'label': L, 'title': 'O combinado fica registrado', 'setup': go,
  'narration': ['Em Assinaturas, os planos mostram valor, ciclo, visitas e serviços incluídos.',
                'Quando o cliente assina, essas condições ficam salvas no contrato dele.',
                'Mesmo que você crie planos novos depois, o combinado com quem já assinou continua ali.'],
  'acts': [c1_0, c1_1, c1_2]},
 {'id': 'assinaturas-2', 'label': L, 'title': 'Quantas visitas ainda tem?', 'setup': go,
  'narration': ['Na aba Contratos, você vê cada assinante, o plano e o próximo ciclo.',
                'Abra um contrato para conferir o que ele contratou.',
                'O saldo de visitas acompanha os atendimentos feitos pelo plano, separados dos avulsos.'],
  'acts': [c2_0, c2_1, c2_2]},
 {'id': 'assinaturas-3', 'label': L, 'title': 'Já pagou ou ainda está pendente?', 'setup': go,
  'narration': ['O calendário mostra os próximos ciclos de cada assinatura.',
                'Ao lado, o status: ativo, aguardando ou em atraso.',
                'A renovação e os novos usos seguem a confirmação do pagamento.'],
  'acts': [c3_0, c3_1, c3_2]},
 {'id': 'assinaturas-4', 'label': L, 'title': 'Saiba quem precisa de atenção', 'setup': go,
  'narration': ['O valor em atraso aparece logo no painel.',
                'Na aba Inadimplentes, ficam os contratos com pagamento pendente.',
                'Com o plano e o ciclo em mãos, fica mais fácil conversar com o cliente.'],
  'acts': [c4_0, c4_1, c4_2]},
 {'id': 'assinaturas-5', 'label': L, 'title': 'Seu clube está dando resultado?', 'setup': go,
  'narration': ['A saúde dos planos começa pela receita recorrente do mês.',
                'Você acompanha quantos assinantes estão com o ciclo ativo e o que foi recebido.',
                'E vê os cancelamentos e a margem de contribuição do clube.'],
  'acts': [c5_0, c5_1, c5_2]},
 {'id': 'assinaturas-6', 'label': L, 'title': 'Receba na conta da barbearia', 'setup': go,
  'narration': ['O dinheiro das assinaturas vai para a conta da barbearia.',
                'Em Configurações, conecte a sua conta do Mercado Pago.',
                'Esses recebimentos ficam separados da mensalidade que você paga pelo sistema.'],
  'acts': [c6_0, c6_1, c6_2]},
]
