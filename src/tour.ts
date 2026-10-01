import { moduleLabels, type ModuleKey, type Role } from './types'

export type TourModule = ModuleKey | 'master' | 'client'

export interface TourStep {
  module: TourModule
  kind: 'nav' | 'content'
  selector: string
  title: string
  description: string
  practice?: {
    instruction: string
    completeOn?: 'click' | 'input' | 'focus'
  }
}

export interface TourChapter {
  id: string
  module: TourModule
  title: string
  summary: string
  group: string
  steps: TourStep[]
}

interface ChapterCopy {
  module: ModuleKey
  title: string
  summary: string
  group: string
  focus: string
  focusSelector: string
  action: string
  actionSelector: string
}

const adminChapters: ChapterCopy[] = [
  { module: 'dashboard', title: 'Comece pela visão geral', summary: 'Leia os principais números e encontre o próximo atendimento.', group: 'GESTÃO', focus: 'Veja o panorama do dia. Os cartões e a agenda usam os registros da sua barbearia.', focusSelector: '.content .stats-grid', action: 'Use os indicadores para decidir qual área abrir. Confira a origem dos números antes de agir.', actionSelector: '.content .dashboard-grid' },
  { module: 'reports', title: 'Entenda faturamento e retorno', summary: 'Ajuste o período e investigue ticket, novos clientes e retenção.', group: 'GESTÃO', focus: 'Escolha uma faixa rápida ou informe as datas. O período escolhido muda a leitura de faturamento e ticket.', focusSelector: '.content .report-quick-ranges', action: 'Alterne entre “Faturamento e ticket” e “Clientes e retorno” para comparar receita, primeira visita e retorno por profissional.', actionSelector: '.content .report-section-tabs' },
  { module: 'appointments', title: 'Organize a agenda', summary: 'Veja horários e inicie um agendamento com dados completos.', group: 'GESTÃO', focus: 'Navegue entre os dias e confira os horários livres de cada profissional.', focusSelector: '.content .calendar-toolbar', action: 'Em “Novo agendamento”, escolha cliente, barbeiro, serviço e horário. Confira o valor e a assinatura antes de confirmar.', actionSelector: '.content .page-actions .button' },
  { module: 'clients', title: 'Cuide dos clientes', summary: 'Cadastre clientes e mantenha o histórico de atendimentos.', group: 'GESTÃO', focus: 'Nesta área você encontra os contatos e o histórico dos clientes da barbearia.', focusSelector: '.content .panel', action: 'Cadastre o cliente e vincule o profissional responsável. Esse vínculo limita o que cada barbeiro pode visualizar.', actionSelector: '.content .page-actions .button' },
  { module: 'services', title: 'Configure serviços e horários', summary: 'Defina procedimentos, valores e disponibilidade da equipe.', group: 'GESTÃO', focus: 'Cadastre duração e preço de cada serviço; eles aparecem no agendamento público.', focusSelector: '.content .panel', action: 'Depois, configure os horários de trabalho para que o cliente veja somente horários disponíveis.', actionSelector: '.content .panel:nth-of-type(2)' },
  { module: 'subscriptions', title: 'Monte as assinaturas', summary: 'Crie planos e acompanhe contratos e recebíveis.', group: 'OPERAÇÃO', focus: 'Use estas abas para separar contratos, planos, recebíveis e inadimplentes.', focusSelector: '.content .segmented', action: 'Crie um plano com preço, ciclo, visitas e serviços incluídos. A cobrança precisa ser confirmada pelo provedor.', actionSelector: '.content .page-actions .button' },
  { module: 'products', title: 'Cadastre produtos', summary: 'Mantenha preços, custos e estoque atualizados.', group: 'OPERAÇÃO', focus: 'O catálogo separa itens de barbearia, bar e cozinha.', focusSelector: '.content .segmented', action: 'Em “Novo produto”, informe categoria, valor, custo e quantidade em estoque.', actionSelector: '.content .page-actions .button' },
  { module: 'bar', title: 'Controle bar e cozinha', summary: 'Registre comandas e acompanhe a entrega.', group: 'OPERAÇÃO', focus: 'Acompanhe as comandas abertas e os itens consumidos.', focusSelector: '.content .order-grid, .content .page-stack > .panel', action: 'Crie a comanda com produtos cadastrados e marque o pedido como entregue após a entrega real.', actionSelector: '.content .page-actions .button' },
  { module: 'finance', title: 'Conheça os custos', summary: 'Registre despesas e analise a margem desejada.', group: 'RESULTADOS', focus: 'Informe o custo da estrutura e a meta de lucro para entender a margem da barbearia.', focusSelector: '.content .panel', action: 'Lance despesas com data e categoria. Depois peça uma sugestão de preços à IA e confira os números.', actionSelector: '.content .page-actions .button' },
  { module: 'goals', title: 'Defina metas', summary: 'Acompanhe objetivos da loja e da equipe.', group: 'RESULTADOS', focus: 'Veja o andamento das metas da barbearia e dos profissionais.', focusSelector: '.content .goal-grid, .content .page-stack > .panel', action: 'Crie uma meta para a loja ou atribua uma meta individual a um barbeiro.', actionSelector: '.content .page-actions .button' },
  { module: 'partners', title: 'Monte o Clube do Parceiro', summary: 'Cadastre parceiros e crie ofertas com regras próprias.', group: 'CRESCIMENTO', focus: 'Acompanhe parceiros ativos, ofertas e reservas atribuídas ao programa.', focusSelector: '.content .partner-club-stats', action: 'Cadastre o parceiro, crie um cupom com benefício e copie o link de indicação. O cliente verá o desconto antes de confirmar a reserva.', actionSelector: '.content .partner-club-tabs' },
  { module: 'marketing', title: 'Planeje o marketing', summary: 'Siga as tarefas orgânicas e o roteiro de anúncios.', group: 'CRESCIMENTO', focus: 'Leia as etapas de conteúdo orgânico e campanhas pagas antes de criar uma ação.', focusSelector: '.content .page-stack > .panel:first-of-type', action: 'Registre uma tarefa com canal e prazo. Analise os resultados antes de ampliar investimento.', actionSelector: '.content .page-actions .button' },
  { module: 'ai', title: 'Converse com a IA sobre a barbearia', summary: 'Tire dúvidas, peça orientações ou prepare um cadastro.', group: 'CRESCIMENTO', focus: 'Escreva sua pergunta ou pedido com linguagem natural. A IA considera o contexto disponível desta barbearia.', focusSelector: '.content .ai-help-input textarea', action: 'Respostas não alteram registros. Se houver uma ação disponível, revise a proposta e confirme apenas quando os campos estiverem corretos.', actionSelector: '.content .ai-help-thread' },
  { module: 'bio', title: 'Monte a mini bio', summary: 'Reúna agendamento, produtos, assinatura e contato.', group: 'CRESCIMENTO', focus: 'O endereço público da barbearia aparece aqui. Teste os links antes de compartilhar.', focusSelector: '.content .public-url', action: 'Adicione links com nomes claros e organize a ordem em que o cliente verá cada ação.', actionSelector: '.content .page-actions .button' },
  { module: 'branding', title: 'Crie a identidade da loja', summary: 'Analise o Instagram, revise a prévia e publique.', group: 'SISTEMA', focus: 'Cadastre o link oficial do Instagram. A análise propõe cores, tipografia e tom para esta barbearia.', focusSelector: '.content .brand-studio-grid .panel:first-child', action: 'Revise a prévia e publique somente quando a aparência estiver fiel à empresa.', actionSelector: '.content .brand-review-grid .panel:nth-child(2)' },
  { module: 'settings', title: 'Ajuste equipe e permissões', summary: 'Convide pessoas e libere as abas individualmente.', group: 'SISTEMA', focus: 'Revise os dados e integrações da barbearia nesta tela.', focusSelector: '.content .dashboard-grid', action: 'Convide cada integrante e configure, para cada barbeiro, as abas que ele pode acessar.', actionSelector: '.content .permission-overview' },
]

const barberChapters: ChapterCopy[] = [
  { module: 'dashboard', title: 'Veja seu dia', summary: 'Consulte seus atendimentos e números pessoais.', group: 'SEU TRABALHO', focus: 'Confira os atendimentos do dia antes de começar.', focusSelector: '.content .dashboard-grid', action: 'Use os cartões para acompanhar seus números conforme as permissões liberadas pela barbearia.', actionSelector: '.content .stats-grid' },
  { module: 'reports', title: 'Entenda seus resultados', summary: 'Acompanhe ticket, faturamento e retorno dos seus clientes.', group: 'SEU TRABALHO', focus: 'Escolha o período que deseja comparar.', focusSelector: '.content .report-quick-ranges', action: 'Alterne entre faturamento e clientes para ver os indicadores disponíveis para você.', actionSelector: '.content .report-section-tabs' },
  { module: 'appointments', title: 'Consulte sua agenda', summary: 'Veja horários e atendimentos atribuídos a você.', group: 'SEU TRABALHO', focus: 'Navegue pelos dias e confira os atendimentos agendados.', focusSelector: '.content .calendar-toolbar', action: 'Abra um atendimento para ver os detalhes. Atualize o estado somente após realizar o procedimento.', actionSelector: '.content .calendar-shell' },
  { module: 'clients', title: 'Conheça seus clientes', summary: 'Consulte o histórico dos clientes vinculados a você.', group: 'SEU TRABALHO', focus: 'Nesta lista aparecem apenas os clientes aos quais você tem acesso.', focusSelector: '.content .panel', action: 'Abra um cadastro antes do atendimento para revisar preferências e histórico.', actionSelector: '.content .table-scroll' },
  { module: 'services', title: 'Revise procedimentos', summary: 'Confira duração e preços publicados.', group: 'SEU TRABALHO', focus: 'Consulte os serviços para orientar o cliente com o preço e o tempo corretos.', focusSelector: '.content .panel', action: 'Veja também seus horários de atendimento definidos pela barbearia.', actionSelector: '.content .panel:nth-of-type(2)' },
  { module: 'subscriptions', title: 'Confira a assinatura', summary: 'Veja se o plano cobre o serviço e os usos restantes.', group: 'ATENDIMENTO', focus: 'Abra o contrato do cliente e confira o status da assinatura.', focusSelector: '.content .segmented', action: 'Antes de agendar, confirme os serviços cobertos e quantas visitas restam no ciclo.', actionSelector: '.content .panel' },
  { module: 'products', title: 'Conheça o estoque', summary: 'Consulte disponibilidade antes de oferecer um item.', group: 'ATENDIMENTO', focus: 'Filtre os produtos por categoria para encontrar o item.', focusSelector: '.content .segmented', action: 'Confira preço e estoque no catálogo antes de orientar o cliente.', actionSelector: '.content .panel' },
  { module: 'bar', title: 'Acompanhe comandas', summary: 'Registre consumo e conclusão de pedidos.', group: 'ATENDIMENTO', focus: 'Veja as comandas abertas da barbearia.', focusSelector: '.content .order-grid, .content .page-stack > .panel', action: 'Registre os itens consumidos e conclua a comanda após a entrega.', actionSelector: '.content .page-actions .button' },
  { module: 'goals', title: 'Acompanhe suas metas', summary: 'Defina um objetivo pessoal e veja as metas recebidas.', group: 'EVOLUÇÃO', focus: 'Consulte o andamento da sua meta pessoal e das metas atribuídas pelo administrador.', focusSelector: '.content .goal-grid, .content .page-stack > .panel', action: 'Crie uma meta pessoal com indicador, valor e prazo.', actionSelector: '.content .page-actions .button' },
  { module: 'partners', title: 'Conheça o Clube do Parceiro', summary: 'Veja os benefícios e links de indicação.', group: 'EVOLUÇÃO', focus: 'Veja as ofertas ativas na barbearia.', focusSelector: '.content .partner-club-stats', action: 'Abra “Ofertas e cupons” para encontrar regras e copiar o link correto.', actionSelector: '.content .partner-club-tabs' },
  { module: 'marketing', title: 'Siga o plano de marketing', summary: 'Veja tarefas orgânicas e orientações de anúncios.', group: 'EVOLUÇÃO', focus: 'Siga a sequência de ações orgânicas da barbearia.', focusSelector: '.content .page-stack > .panel:first-of-type', action: 'Use o roteiro de anúncios como referência e alinhe a publicação com a administração.', actionSelector: '.content .page-stack > .panel:first-of-type .segmented' },
  { module: 'ai', title: 'Converse com a IA sobre seu trabalho', summary: 'Tire dúvidas e prepare ações dentro dos seus acessos.', group: 'EVOLUÇÃO', focus: 'Pergunte sobre seus horários e atividades ou peça ajuda para planejar uma meta pessoal.', focusSelector: '.content .ai-help-input textarea', action: 'A IA responde com os dados que seu perfil pode ver. Um cadastro só é gravado quando você revisa e confirma a proposta.', actionSelector: '.content .ai-help-thread' },
  { module: 'bio', title: 'Compartilhe o link correto', summary: 'Encontre a página pública de agendamento.', group: 'EVOLUÇÃO', focus: 'Copie o endereço público da barbearia para orientar seus clientes.', focusSelector: '.content .public-url', action: 'Confira se o botão de agendamento leva à página certa.', actionSelector: '.content .phone-frame' },
  { module: 'settings', title: 'Entenda seus acessos', summary: 'Confira o que a administração liberou para você.', group: 'SISTEMA', focus: 'O menu lateral mostra as abas liberadas para você. No celular, abra o menu pelo botão no topo.', focusSelector: '.content .page-header', action: 'Se precisar de outra aba, peça ao administrador da sua barbearia.', actionSelector: '.content .dashboard-grid' },
]

function chapterFromCopy(copy: ChapterCopy): TourChapter {
  const moduleLabel = moduleLabels[copy.module]
  const focusIsText = copy.focusSelector.includes('textarea') || copy.focusSelector.includes('input')
  const actionIsText = copy.actionSelector.includes('textarea') || copy.actionSelector.includes('input')
  return {
    id: copy.module,
    module: copy.module,
    title: copy.title,
    summary: copy.summary,
    group: copy.group,
    steps: [
      { module: copy.module, kind: 'nav', selector: `[data-tour-nav="${copy.module}"]`, title: `Abra ${moduleLabel}`, description: `${copy.summary} Clique na aba destacada para abrir a tela.`, practice: { instruction: `Clique na aba ${moduleLabel} para continuar.`, completeOn: 'click' } },
      { module: copy.module, kind: 'content', selector: copy.focusSelector, title: 'Onde começar', description: copy.focus, practice: { instruction: focusIsText ? 'Clique no campo destacado e digite um teste curto para praticar.' : 'Clique ou toque na área destacada para reconhecer onde essa informação fica.', completeOn: focusIsText ? 'input' : 'click' } },
      { module: copy.module, kind: 'content', selector: copy.actionSelector, title: 'Teste rápido', description: copy.action, practice: { instruction: actionIsText ? 'Digite um teste curto no campo destacado. Nada é enviado sem você confirmar.' : 'Faça um teste na área destacada. Pode abrir, clicar ou focar no recurso; nada é salvo sem confirmação.', completeOn: actionIsText ? 'input' : 'click' } },
    ],
  }
}

const masterChapter: TourChapter = {
  id: 'master', module: 'master', title: 'Administre a plataforma', group: 'PLATAFORMA',
  summary: 'Crie barbearias, ajuste o valor por barbeiro e acompanhe a cobrança.',
  steps: [
    { module: 'master', kind: 'nav', selector: '[data-tour-nav="master"]', title: 'Abra o Painel master', description: 'Este acesso reúne todas as barbearias cadastradas na plataforma.', practice: { instruction: 'Clique em Painel master para confirmar que você sabe voltar para a visão da plataforma.', completeOn: 'click' } },
    { module: 'master', kind: 'content', selector: '.content .page-actions .button', title: 'Crie uma barbearia', description: 'Cadastre uma empresa com nome e endereço público. Depois selecione a loja para configurar a operação.', practice: { instruction: 'Clique no botão destacado para abrir o cadastro. Você pode fechar a janela depois; nada é salvo sem confirmar.', completeOn: 'click' } },
    { module: 'master', kind: 'content', selector: '.content .dashboard-grid .panel:nth-child(2)', title: 'Defina o valor por barbeiro', description: 'Configure aqui a mensalidade central por profissional ativo. Confira o valor antes de habilitar a cobrança.', practice: { instruction: 'Clique neste bloco e identifique onde fica o valor por barbeiro.', completeOn: 'click' } },
    { module: 'master', kind: 'content', selector: '.content .dashboard-grid .panel:first-child', title: 'Convide o administrador', description: 'Vincule o administrador à barbearia certa e confira o acesso antes de entregar a conta.', practice: { instruction: 'Clique no bloco destacado para revisar onde entram os dados da barbearia.', completeOn: 'click' } },
  ],
}

const masterAiChapter: ChapterCopy = {
  module: 'ai', title: 'Converse com a IA da plataforma',
  summary: 'Pergunte sobre a operação da plataforma ou prepare o cadastro de uma barbearia.',
  group: 'PLATAFORMA',
  focus: 'Sem uma loja selecionada, descreva uma dúvida sobre a plataforma ou peça para preparar uma nova barbearia.',
  focusSelector: '.content .ai-help-input textarea',
  action: 'A conversa não muda dados. Para criar uma barbearia, confira a prévia e confirme a ação.',
  actionSelector: '.content .ai-help-thread',
}

const clientChapter: TourChapter = {
  id: 'client', module: 'client', title: 'Conheça sua área', group: 'SUA CONTA',
  summary: 'Encontre horários, visitas, assinatura e agendamento.',
  steps: [
    { module: 'client', kind: 'content', selector: '[data-tour-client="summary"]', title: 'Sua área pessoal', description: 'Aqui aparecem seus horários e benefícios nesta barbearia.', practice: { instruction: 'Toque neste resumo para identificar onde começa sua área.', completeOn: 'click' } },
    { module: 'client', kind: 'content', selector: '[data-tour-client="stats"]', title: 'Seu resumo', description: 'Confira visitas concluídas, valor pago e quantos usos ainda restam no plano, quando houver assinatura ativa.', practice: { instruction: 'Toque nos números e confira quais indicadores aparecem para você.', completeOn: 'click' } },
    { module: 'client', kind: 'content', selector: '[data-tour-client="upcoming"]', title: 'Próximos horários', description: 'Veja os agendamentos confirmados e a data de cada atendimento.', practice: { instruction: 'Toque nesta área para localizar seus próximos horários.', completeOn: 'click' } },
    { module: 'client', kind: 'content', selector: '[data-tour-client="plan"]', title: 'Sua assinatura', description: 'Confira o plano, o ciclo atual e as visitas disponíveis antes de agendar.', practice: { instruction: 'Toque no plano para reconhecer onde ficam os usos restantes.', completeOn: 'click' } },
    { module: 'client', kind: 'content', selector: '[data-tour-client="history"]', title: 'Histórico de visitas', description: 'Revise os dias em que você foi atendido, os valores e os procedimentos registrados.', practice: { instruction: 'Toque no histórico e veja onde consultar visitas anteriores.', completeOn: 'click' } },
    { module: 'client', kind: 'content', selector: '[data-tour-client="book"]', title: 'Faça seu próximo agendamento', description: 'Abra o agendamento, escolha procedimento, barbeiro e um horário disponível. Confira o valor antes de concluir.', practice: { instruction: 'Toque no agendamento para praticar onde iniciar uma nova reserva.', completeOn: 'click' } },
  ],
}

export function getTourChapters(role: Role, allowedModules: ModuleKey[], hasShop: boolean): TourChapter[] {
  if (role === 'client') return [clientChapter]
  if (role === 'master' && !hasShop) {
    return [masterChapter, ...(allowedModules.includes('ai') ? [chapterFromCopy(masterAiChapter)] : [])]
  }
  const list = role === 'barber' ? barberChapters : adminChapters
  const chapters = list.filter(copy => allowedModules.includes(copy.module as ModuleKey)).map(chapterFromCopy)
  return role === 'master' ? [masterChapter, ...chapters] : chapters
}

export function tourStorageKey(userId: string, shopId: string | undefined, role: Role): string {
  return `barber-guided-tour:v1:${userId}:${shopId || 'platform'}:${role}`
}

export function readFinishedTours(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}

export function saveFinishedTours(key: string, ids: string[]): void {
  try { localStorage.setItem(key, JSON.stringify([...new Set([...readFinishedTours(key), ...ids])])) } catch { /* The tour remains usable without browser storage. */ }
}
