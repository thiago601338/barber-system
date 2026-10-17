from common import *

L = 'Site e MiniBio'

def slots_extra(req):
    if '/rpc/available_slots' in req.url:
        return fake_slots()
    return None

def m1_0(d): d.hover(d.pg.get_by_text('Instagram da barbearia').first, 1000)
def m1_1(d):
    d.hover(d.pg.get_by_text('Analisar e criar').first, 900)
    d.type(d.pg.locator('textarea').first, 'Ambiente clássico, tons escuros e acabamento dourado', delay=35)
def m1_2(d):
    d.nav('bio', 1800)
    d.hover(d.pg.locator('.phone-shell, [class*=phone], [class*=preview]').first, 1500)

def pub(d):
    d.pg.goto(BASE + '/b/kingsman'); d.pg.wait_for_timeout(3500); d._ensure_cursor()

def m2_0(d): d.hover(d.pg.get_by_text('Cuide do seu estilo').first, 900); d.scroll(450, after=600)
def m2_1(d): d.scroll(400, after=900)
def m2_2(d):
    d.pg.goto(BASE + '/b/kingsman/agendar'); d.pg.wait_for_timeout(2600); d._ensure_cursor()
    d.scroll_to(d.pg.get_by_text('2. Profissional e data').first, 1600, block='start')

def m3_0(d): d.click(d.pg.get_by_text('Agendar procedimento').first, 2400); d._ensure_cursor()
def m3_1(d):
    d.click(d.pg.get_by_text('corte masculino', exact=True).first, 700)
    d.scroll_to(d.pg.get_by_text('2. Profissional e data').first, 600, block='start')
    d.click(d.pg.get_by_text('Lorenzo Pinto').first, 600)
    dt = d.pg.locator('input[type=date]').first; d.click(dt, 200); dt.fill('2026-10-19'); d.wait(1500)
def m3_2(d):
    d.scroll_to(d.pg.get_by_text('3. Horário disponível').first, 700, block='start')
    d.click(d.pg.locator('button.slot').nth(4), 900)
    d.scroll_to(d.pg.get_by_text('Condições do agendamento').first, 1500)

def m4_0(d): d.scroll_to(d.pg.get_by_text('Seleção da barbearia').first, 1200, block='start')
def m4_1(d): d.scroll(500, after=900)
def m4_2(d): d.scroll_to(d.pg.get_by_text('Mais vantagens para você').first, 1100, block='start'); d.hover(d.pg.get_by_text('Fazer assinatura').first, 1200)

def m5_0(d): d.nav('settings', 1800)
def m5_1(d):
    f = d.pg.locator('form').filter(has_text='WhatsApp').first.locator('input')
    d.type(f.nth(2), '(82) 99999-0000', delay=55)
    d.hover(d.pg.get_by_text('Instagram e identidade visual').first, 800)
def m5_2(d):
    pub(d)
    d.hover(d.pg.get_by_text('Instagram').first, 1200)
    d.hover(d.pg.get_by_text('Maceió').first, 1200)

def m6_0(d): d.hover(d.pg.get_by_text('Seus links').first, 900)
def m6_1(d): d.hover(d.pg.get_by_text('sistemadebarbearia.com.br/b/kingsman').first, 1500)
def m6_2(d):
    d.click(d.pg.get_by_role('button', name=re.compile('Adicionar link')).first, 1100)
    m = d.modal(); ins = m.locator('input')
    d.type(ins.nth(0), 'Promoção de sexta', delay=50)

SCRIPTS = [
 {'id': 'minibio-1', 'label': L, 'title': 'Tem que ter a sua cara', 'setup': lambda d: d.nav('branding', 2200),
  'narration': ['Em Identidade visual, você parte do Instagram da barbearia.',
                'Descreva o ambiente, e a IA sugere cores, tipografia e o estilo da página.',
                'A identidade aparece na MiniBio, na área do cliente e na da equipe.'],
  'acts': [m1_0, m1_1, m1_2]},
 {'id': 'minibio-2', 'label': L, 'title': 'Mostre quem atende e o que faz', 'setup': pub, 'wait_for': 'body', 'url': '/b/kingsman',
  'narration': ['Esta é a página pública da barbearia.',
                'Os serviços aparecem com tempo e preço, do jeito que estão cadastrados.',
                'E na hora de agendar, o cliente vê a equipe e escolhe com quem quer cortar.'],
  'acts': [m2_0, m2_1, m2_2]},
 {'id': 'minibio-3', 'label': L, 'title': 'Do serviço escolhido ao horário marcado', 'setup': pub, 'wait_for': 'body', 'url': '/b/kingsman', 'extra': slots_extra,
  'narration': ['O cliente toca em agendar procedimento.',
                'Escolhe o serviço, o barbeiro e o dia.',
                'Vê só as vagas que cabem na agenda, com as regras de cancelamento já à vista.'],
  'acts': [m3_0, m3_1, m3_2]},
 {'id': 'minibio-4', 'label': L, 'title': 'Tem plano? Vende produtos?', 'setup': pub, 'wait_for': 'body', 'url': '/b/kingsman',
  'narration': ['Na mesma página, aparecem os produtos da barbearia.',
                'Com foto, preço e disponibilidade.',
                'E os planos de assinatura, para o cliente assinar direto por ali.'],
  'acts': [m4_0, m4_1, m4_2]},
 {'id': 'minibio-5', 'label': L, 'title': 'Ficou com dúvida? Tem como falar com você', 'setup': lambda d: d.nav('dashboard', 1500),
  'narration': ['Em Configurações, informe o telefone, o WhatsApp e o Instagram da barbearia.',
                'Esses contatos vão para a página pública.',
                'Assim, o cliente encontra o Instagram e o endereço de onde a barbearia fica.'],
  'acts': [m5_0, m5_1, m5_2]},
 {'id': 'minibio-6', 'label': L, 'title': 'Um endereço só seu para compartilhar', 'setup': lambda d: d.nav('bio', 2200),
  'narration': ['Na Mini bio fica o endereço da sua página.',
                'É sistemadebarbearia ponto com ponto br, barra b, barra o nome da barbearia.',
                'Dá para adicionar links extras e colocar tudo na bio do Instagram.'],
  'acts': [m6_0, m6_1, m6_2]},
]
