from common import *

L = 'Controle financeiro'
def tab(d, name, after=1500):
    d.click(d.pg.get_by_role('button', name=name, exact=True).first, after)

def f1_0(d):
    d.pg.wait_for_selector('text=Recebido, vendido e previsto', timeout=40000)
    d.scroll_to(d.pg.get_by_text('Recebido, vendido e previsto').first, 1000, block='start')
def f1_1(d):
    d.hover(d.pg.get_by_text('Recebido', exact=True).first, 1000)
    d.hover(d.pg.get_by_text('Vendido / realizado').first, 1000)
def f1_2(d):
    d.hover(d.pg.get_by_text('Previsto na agenda').first, 1100)
    d.hover(d.pg.get_by_text('Como os indicadores são calculados').first, 900)

def f2_0(d): d.nav('finance', 1500); tab(d, 'Caixa e comandas')
def f2_1(d):
    d.click(d.pg.get_by_role('button', name=re.compile('Abrir caixa')).first, 1300)
def f2_2(d):
    m = d.modal()
    inp = m.locator('input').first
    d.type(inp, '150', delay=120)
    d.hover(m.locator('button').last, 1000)
    d.close_modal(500)
    d.scroll_to(d.pg.get_by_text('Comandas e atendimentos a receber').first, 900)

def f3_0(d): d.nav('finance', 1800)
def f3_1(d):
    d.click(d.pg.get_by_role('button', name=re.compile('Registrar despesa')).first, 1200)
    m = d.modal()
    d.type(m.locator('input[type=text], input:not([type])').first, 'Conta de energia', delay=50)
def f3_2(d):
    m = d.modal()
    sel = m.locator('select')
    if sel.count():
        d.select(sel.first, index=1, after=600)
    num = m.locator('input[type=number], input[inputmode=decimal]')
    if num.count():
        d.type(num.first, '420', delay=110)
    d.hover(m.locator('button').last, 900)

def f4_0(d):
    d.nav('profit', 1800); d.pg.wait_for_selector('text=Produtos e serviços', timeout=40000); d.click(d.text('Produtos e serviços').first, 1800)
def f4_1(d): d.scroll_to(d.pg.get_by_text('Resultado dos itens vendidos').first, 1300, block='start')
def f4_2(d):
    d.click(d.text('Precificação').first, 1200)
    flds = d.pg.locator('form input')
    for i, v in enumerate(['12', '0', '70']):
        f = flds.nth(i); d.click(f, 150); f.fill(''); f.press_sequentially(v, delay=110)
    d.wait(1600)

def f5_0(d): d.nav('products', 1800); d.hover(d.pg.locator('table thead th').filter(has_text='Estoque').first, 900)
def f5_1(d): d.click(d.pg.locator('table tbody tr').nth(2), 1600)
def f5_2(d):
    m = d.modal(); d.scroll_to(m.get_by_text('Estoque atual').first, 1300); d.close_modal(500)
    d.scroll(1400, after=700)

def f6_0(d): d.nav('finance', 1500); tab(d, 'Comissões da equipe', 1600)
def f6_1(d): tab(d, 'Regras de comissão', 1500)
def f6_2(d): tab(d, 'Extrato', 1000); d.hover(d.pg.get_by_text('Lançamentos para revisar').first, 1300)

SCRIPTS = [
 {'id': 'financeiro-1', 'label': L, 'title': 'O que entrou e o que ainda vem', 'setup': lambda d: d.nav('dashboard', 2500),
  'narration': ['No painel, o dinheiro aparece separado em três partes.',
                'O que já foi recebido, e o que foi vendido ou realizado.',
                'E o que ainda está previsto na agenda. Cada número abre os registros de onde veio.'],
  'acts': [f1_0, f1_1, f1_2]},
 {'id': 'financeiro-2', 'label': L, 'title': 'Feche o caixa com os registros na mão', 'setup': lambda d: d.nav('dashboard', 1500),
  'narration': ['Em Financeiro, a aba Caixa e comandas organiza o dia.',
                'Abra o caixa com o valor que está na gaveta.',
                'Durante o dia, entram comandas e pagamentos em dinheiro, Pix ou cartão, prontos para conferir no fechamento.'],
  'acts': [f2_0, f2_1, f2_2]},
 {'id': 'financeiro-3', 'label': L, 'title': 'Aluguel, energia, material…', 'setup': lambda d: d.nav('dashboard', 1500),
  'narration': ['As despesas da barbearia ficam no Financeiro.',
                'Clique em registrar despesa e descreva o gasto.',
                'Escolha o tipo e o valor. Assim você sabe quanto custa manter as portas abertas.'],
  'acts': [f3_0, f3_1, f3_2]},
 {'id': 'financeiro-4', 'label': L, 'title': 'Quanto sobra em cada venda?', 'setup': lambda d: d.nav('dashboard', 1500),
  'narration': ['Em Margem de Lucro, veja o resultado de cada produto e serviço.',
                'Receita, custo total, contribuição e margem, item por item.',
                'E use o simulador para testar um preço antes de mudar no catálogo.'],
  'acts': [f4_0, f4_1, f4_2]},
 {'id': 'financeiro-5', 'label': L, 'title': 'O produto entrou, saiu ou foi usado?', 'setup': lambda d: d.nav('dashboard', 1500),
  'narration': ['Em Produtos, cada item mostra preço e estoque.',
                'Abra um produto para ver preço, custo, estoque atual e o mínimo para repor.',
                'Compras, vendas, consumo e ajustes ficam registrados no histórico de estoque.'],
  'acts': [f5_0, f5_1, f5_2]},
 {'id': 'financeiro-6', 'label': L, 'title': 'Comissão sem depender da memória', 'setup': lambda d: d.nav('dashboard', 1500),
  'narration': ['As comissões ficam em Financeiro, na aba da equipe.',
                'Defina a regra de cada profissional para serviços e produtos.',
                'O extrato mostra o que está disponível, o que aguarda recebimento e o que precisa de revisão.'],
  'acts': [f6_0, f6_1, f6_2]},
]
