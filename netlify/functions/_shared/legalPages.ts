import {company,companyAddressLine,legalLinks,organizationSchema} from './companyInfo'
import {publicWhatsappUrl} from './publicContact'
import {renderPublicShell} from './marketingPages'

const esc = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const origin = 'https://sistemadebarbearia.com.br'
const mail = `<a href="mailto:${company.email}">${company.email}</a>`
const wa = `<a data-whatsapp-contact href="${esc(publicWhatsappUrl('o Barber System'))}" target="_blank" rel="noopener noreferrer">${company.phone} (WhatsApp)</a>`
const identification = `<strong>${company.legalName}</strong>, inscrita no CNPJ sob o nº <strong>${company.cnpj}</strong>, com sede na ${companyAddressLine}`

interface LegalPage {path:string;title:string;h1:string;eyebrow:string;description:string;lead:string;body:string;type?:string}

const companyTable = `<dl class="legal-facts">
<div><dt>Marca</dt><dd>${company.brand}</dd></div>
<div><dt>Razão social</dt><dd>${company.legalName}</dd></div>
<div><dt>Nome fantasia (cadastro)</dt><dd>${company.tradeName}</dd></div>
<div><dt>CNPJ</dt><dd>${company.cnpj}</dd></div>
<div><dt>Natureza jurídica</dt><dd>${company.legalNature}</dd></div>
<div><dt>Porte</dt><dd>${company.size}</dd></div>
<div><dt>Atividade principal</dt><dd>${company.mainActivity}</dd></div>
<div><dt>Situação cadastral</dt><dd>${company.status} desde ${company.openedAt}</dd></div>
<div><dt>Endereço</dt><dd>${companyAddressLine}</dd></div>
<div><dt>E-mail</dt><dd>${mail}</dd></div>
<div><dt>WhatsApp</dt><dd>${wa}</dd></div>
</dl>`

export const legalPages: LegalPage[] = [
{
 path:'/sobre', type:'AboutPage',
 title:'Sobre o Barber System | Quem somos',
 h1:'Quem está por trás do Barber System',
 eyebrow:'SOBRE NÓS',
 description:`Conheça o Barber System, sistema de gestão para barbearias operado por ${company.legalName} (CNPJ ${company.cnpj}), em Maceió/AL.`,
 lead:'O Barber System é um sistema de gestão feito para a rotina de barbearias e de barbeiros que trabalham por conta própria.',
 body:`<h2>O que fazemos</h2>
<p>O Barber System reúne em um só lugar a agenda online, o cadastro de clientes, os planos de assinatura, o caixa, as comissões, os produtos e a página da barbearia com agendamento. A ideia é simples: deixar o dono e a equipe com mais tempo para atender, e com os números do negócio ao alcance de alguns toques.</p>
<h2>Quem é a empresa responsável</h2>
<p>O Barber System é operado por ${identification}. Somos uma empresa do próprio setor de barbearia: conhecemos de perto a correria entre um atendimento e outro, o fechamento do caixa e a conferência das comissões.</p>
${companyTable}
<h2>Como trabalhamos</h2>
<ul>
<li><strong>Transparência nos preços:</strong> os valores da mensalidade ficam publicados na página <a href="/precos">Planos e preços</a>, com a simulação por tamanho de equipe.</li>
<li><strong>Cada pessoa com seu acesso:</strong> o dono escolhe o que cada profissional pode ver e fazer no sistema.</li>
<li><strong>Cuidado com os dados:</strong> tratamos dados pessoais de acordo com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018). Veja a nossa <a href="/politica-de-privacidade">Política de Privacidade</a>.</li>
<li><strong>Contrato claro:</strong> as regras de uso, pagamento e cancelamento estão nos <a href="/termos-de-uso">Termos de Uso</a> e na <a href="/politica-de-cancelamento-e-reembolso">Política de Cancelamento e Reembolso</a>.</li>
</ul>
<h2>Fale com a gente</h2>
<p>Dúvidas, sugestões ou solicitações: escreva para ${mail} ou chame no ${wa}. Você também encontra todos os canais na página <a href="/contato">Contato</a>.</p>`
},
{
 path:'/contato', type:'ContactPage',
 title:'Contato | Barber System',
 h1:'Fale com o Barber System',
 eyebrow:'CONTATO',
 description:`Canais de atendimento do Barber System: WhatsApp ${company.phone}, e-mail ${company.email} e endereço em Maceió/AL.`,
 lead:'Tem dúvida sobre o sistema, sobre sua inscrição ou sobre a sua conta? Escolha o canal que for melhor para você.',
 body:`<div class="legal-contact-grid">
<article><h2>WhatsApp</h2><p>Para tirar dúvidas sobre o sistema, os planos e a sua inscrição.</p><p class="legal-contact-value">${wa}</p></article>
<article><h2>E-mail</h2><p>Para assuntos da sua conta, pagamentos, cancelamento e pedidos sobre dados pessoais.</p><p class="legal-contact-value">${mail}</p></article>
<article><h2>Endereço</h2><p>${company.legalName}</p><p class="legal-contact-value">${companyAddressLine}</p></article>
</div>
<h2>Quer usar o sistema?</h2>
<p>Faça sua inscrição pelo <a href="/comecar">passo a passo de inscrição</a>: você cria a conta, cadastra a barbearia, escolhe o plano e configura tudo com a nossa ajuda.</p>
<h2>Privacidade e dados pessoais</h2>
<p>Para exercer seus direitos previstos na LGPD (acesso, correção, exclusão, portabilidade e outros), envie sua solicitação para ${mail} com o assunto “Privacidade”. Respondemos em até 15 dias. Saiba mais na <a href="/politica-de-privacidade">Política de Privacidade</a>.</p>
<h2>Dados da empresa</h2>
${companyTable}`
},
{
 path:'/politica-de-privacidade',
 title:'Política de Privacidade | Barber System',
 h1:'Política de Privacidade',
 eyebrow:'PRIVACIDADE E LGPD',
 description:'Saiba quais dados pessoais o Barber System coleta, por que coleta, com quem compartilha e como você exerce seus direitos pela LGPD.',
 lead:`Esta política explica como o Barber System trata dados pessoais no site sistemadebarbearia.com.br, no blog e no sistema de gestão. Última atualização: ${company.policiesUpdatedAt}.`,
 body:`<h2>1. Quem é o responsável pelos dados</h2>
<p>O Barber System é operado por ${identification}. Contato para assuntos de privacidade: ${mail}.</p>
<p>Nos dados que a própria barbearia cadastra no sistema sobre os <em>clientes dela</em> (como nome, telefone, histórico de atendimentos e planos), a barbearia é a controladora e o Barber System atua como operador, tratando esses dados apenas para prestar o serviço contratado.</p>
<h2>2. Quais dados coletamos</h2>
<ul>
<li><strong>Inscrição no site:</strong> nome, e-mail, senha, nome da barbearia, endereço da página, WhatsApp, cidade, perfil (dono ou barbeiro independente) e os profissionais que atendem. Se você usar o formulário de contato, registramos também a data do seu consentimento e um código não reversível gerado a partir do endereço IP, para evitar abuso.</li>
<li><strong>Conta no sistema:</strong> nome, e-mail e senha de acesso (a senha é armazenada de forma criptografada pelo serviço de autenticação), além do vínculo com a barbearia e das permissões de acesso.</li>
<li><strong>Dados da barbearia:</strong> serviços, preços, horários, equipe, agenda, vendas, despesas, comissões, estoque, planos de assinatura e informações da página pública da barbearia.</li>
<li><strong>Clientes da barbearia:</strong> nome, contato, agendamentos, atendimentos realizados, pagamentos e uso de planos, conforme cadastrados pela barbearia ou pelo próprio cliente ao agendar.</li>
<li><strong>Pagamentos:</strong> informações de cobrança e situação dos pagamentos processados pelo Mercado Pago. Não armazenamos o número completo do cartão.</li>
<li><strong>Navegação:</strong> se você aceitar, dados de uso das páginas públicas e do blog pelo Google Analytics (veja a <a href="/politica-de-cookies">Política de Cookies</a>).</li>
</ul>
<h2>3. Para que usamos os dados</h2>
<ul>
<li>Responder à sua inscrição e entrar em contato sobre o sistema (base legal: consentimento e procedimentos preliminares de contrato);</li>
<li>Criar e manter sua conta, prestar o serviço e dar suporte (execução de contrato);</li>
<li>Processar cobranças da mensalidade e dos pagamentos configurados pela barbearia (execução de contrato);</li>
<li>Manter a segurança, prevenir fraudes e abusos (legítimo interesse);</li>
<li>Cumprir obrigações legais, fiscais e regulatórias (cumprimento de obrigação legal);</li>
<li>Entender o uso das páginas públicas para melhorá-las, somente com o seu aceite (consentimento).</li>
</ul>
<p>Não vendemos dados pessoais e não usamos os dados dos clientes das barbearias para fins próprios de marketing.</p>
<h2>4. Com quem compartilhamos</h2>
<p>Compartilhamos dados apenas com fornecedores necessários para o funcionamento do serviço:</p>
<ul>
<li><strong>Supabase</strong> — banco de dados e autenticação;</li>
<li><strong>Netlify</strong> — hospedagem do site e do sistema;</li>
<li><strong>Mercado Pago</strong> — processamento de pagamentos;</li>
<li><strong>OpenAI</strong> — quando você usa a Ajuda de IA, as informações necessárias para responder ao seu pedido são enviadas para gerar a resposta;</li>
<li><strong>ElevenLabs</strong> — geração do áudio dos tutoriais do sistema (apenas o texto dos tutoriais);</li>
<li><strong>Meta (Instagram)</strong> — somente se a barbearia conectar a conta do Instagram ao sistema;</li>
<li><strong>Google (Analytics)</strong> — somente se você aceitar a análise das páginas públicas.</li>
</ul>
<p>Também podemos compartilhar dados quando exigido por lei ou por ordem de autoridade competente.</p>
<h2>5. Transferência internacional</h2>
<p>Alguns desses fornecedores armazenam ou processam dados fora do Brasil, inclusive nos Estados Unidos. Nesses casos, adotamos fornecedores que oferecem garantias de proteção compatíveis com a LGPD, conforme o artigo 33 da lei.</p>
<h2>6. Por quanto tempo guardamos</h2>
<ul>
<li>Dados de inscrição: até 12 meses após o último contato, se você não contratar o serviço;</li>
<li>Dados da conta e da barbearia: enquanto a conta estiver ativa e por até 90 dias após o encerramento, para permitir a reativação ou a exportação, salvo pedido de exclusão antes disso;</li>
<li>Registros fiscais e de pagamento: pelo prazo exigido pela legislação;</li>
<li>Registros de acesso: por 6 meses, conforme o Marco Civil da Internet (Lei nº 12.965/2014).</li>
</ul>
<h2>7. Seus direitos</h2>
<p>Pela LGPD, você pode pedir a confirmação do tratamento, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre compartilhamento, revogação do consentimento e revisão de decisões automatizadas. Envie o pedido para ${mail} com o assunto “Privacidade”. Respondemos em até 15 dias. Se você é cliente de uma barbearia que usa o sistema, também pode falar diretamente com a barbearia.</p>
<p>Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).</p>
<h2>8. Segurança</h2>
<p>Usamos conexão criptografada (HTTPS), controle de acesso por perfil, regras de segurança no banco de dados e credenciais de integração armazenadas de forma criptografada. Nenhum sistema é totalmente imune a incidentes; se algum incidente relevante acontecer, comunicaremos os afetados e a ANPD conforme a lei.</p>
<h2>9. Crianças e adolescentes</h2>
<p>O sistema é destinado a empresas e profissionais. Dados de menores de idade só devem ser cadastrados pela barbearia com autorização do responsável legal.</p>
<h2>10. Alterações</h2>
<p>Podemos atualizar esta política. A data da última atualização fica no topo da página e, em mudanças relevantes, avisaremos pelos canais cadastrados.</p>`
},
{
 path:'/termos-de-uso',
 title:'Termos de Uso | Barber System',
 h1:'Termos de Uso',
 eyebrow:'CONDIÇÕES DO SERVIÇO',
 description:'Termos de Uso do Barber System: regras de acesso, planos, pagamento, responsabilidades e cancelamento do sistema de gestão para barbearias.',
 lead:`Estes termos regulam o uso do site e do sistema Barber System. Ao se inscrever, criar uma conta ou usar o sistema, você concorda com eles. Última atualização: ${company.policiesUpdatedAt}.`,
 body:`<h2>1. Quem presta o serviço</h2>
<p>O Barber System é prestado por ${identification}. Contato: ${mail} e ${wa}.</p>
<h2>2. O que é o Barber System</h2>
<p>É um software de gestão oferecido pela internet (SaaS) para barbearias e barbeiros independentes, com agenda online, cadastro de clientes, planos de assinatura, caixa, comissões, produtos, página pública da barbearia, área do cliente e Ajuda de IA, conforme os recursos disponíveis no plano contratado.</p>
<h2>3. Cadastro e acesso</h2>
<ul>
<li>Você deve informar dados verdadeiros e mantê-los atualizados.</li>
<li>O acesso é pessoal. Cada profissional deve usar o próprio login, e o dono da barbearia define as permissões de cada pessoa.</li>
<li>Você é responsável por manter sua senha em segurança e por avisar a gente se suspeitar de uso indevido.</li>
</ul>
<h2>4. Planos, preços e pagamento</h2>
<ul>
<li>A mensalidade é composta por um valor por barbearia mais um valor por profissional ativo, com limite mensal quando houver. Os valores vigentes ficam publicados em <a href="/precos">Planos e preços</a> e na proposta enviada à barbearia.</li>
<li>A cobrança é recorrente e processada pelo Mercado Pago. As taxas do serviço de pagamento são cobradas à parte.</li>
<li>A Ajuda de IA tem limites de uso, informados nas condições do plano.</li>
<li>Se houver reajuste, avisaremos com pelo menos 30 dias de antecedência. O novo valor vale a partir do ciclo seguinte ao aviso.</li>
<li>Em caso de falta de pagamento, o acesso pode ser suspenso depois de aviso, até a regularização.</li>
</ul>
<h2>5. Dados dos clientes da barbearia</h2>
<p>A barbearia é responsável pelos dados que cadastra sobre os próprios clientes e por ter uma base legal para tratá-los, como prevê a LGPD. O Barber System trata esses dados apenas para prestar o serviço, conforme a <a href="/politica-de-privacidade">Política de Privacidade</a>.</p>
<h2>6. Uso permitido</h2>
<p>Não é permitido usar o sistema para atividades ilegais, enviar mensagens não solicitadas em massa, tentar acessar dados de outras barbearias, burlar limites técnicos ou de segurança, ou copiar e revender o software.</p>
<h2>7. Pagamentos dos clientes da barbearia</h2>
<p>Quando a barbearia conecta a própria conta do Mercado Pago, o dinheiro pago pelos clientes vai para a conta da barbearia e fica separado da mensalidade do sistema. A relação de consumo entre a barbearia e o cliente dela (serviços, planos, preços e reembolsos) é de responsabilidade da barbearia.</p>
<h2>8. Disponibilidade e suporte</h2>
<p>Trabalhamos para manter o sistema disponível o tempo todo, mas podem ocorrer interrupções para manutenção ou por falhas de fornecedores. Sempre que possível, avisaremos manutenções programadas. O suporte é feito pelo WhatsApp e pelo e-mail informados nesta página.</p>
<h2>9. Propriedade intelectual</h2>
<p>O software, a marca Barber System, os textos e o layout do site pertencem à empresa responsável. Os dados cadastrados pela barbearia continuam sendo da barbearia.</p>
<h2>10. Limitação de responsabilidade</h2>
<p>O Barber System é uma ferramenta de apoio à gestão. As decisões tomadas com base nos relatórios e nas respostas da Ajuda de IA são de responsabilidade do usuário. Não respondemos por danos causados por uso indevido da conta, por informações incorretas cadastradas pelo usuário ou por falhas de serviços de terceiros fora do nosso controle, ressalvados os direitos garantidos pelo Código de Defesa do Consumidor.</p>
<h2>11. Cancelamento</h2>
<p>Você pode cancelar quando quiser, sem multa. As regras de cancelamento, arrependimento e reembolso estão na <a href="/politica-de-cancelamento-e-reembolso">Política de Cancelamento e Reembolso</a>.</p>
<h2>12. Alterações destes termos</h2>
<p>Podemos atualizar estes termos. Mudanças relevantes serão avisadas pelos canais cadastrados antes de entrarem em vigor.</p>
<h2>13. Lei aplicável e foro</h2>
<p>Estes termos seguem as leis brasileiras. Fica eleito o foro da comarca de ${company.forum}, ressalvado o direito do consumidor de propor ação no foro do seu domicílio.</p>`
},
{
 path:'/politica-de-cancelamento-e-reembolso',
 title:'Política de Cancelamento e Reembolso | Barber System',
 h1:'Política de Cancelamento e Reembolso',
 eyebrow:'CANCELAMENTO E REEMBOLSO',
 description:'Como cancelar a assinatura do Barber System, prazo de arrependimento de 7 dias, reembolso e o que acontece com os dados da barbearia.',
 lead:`Aqui você encontra como cancelar a mensalidade do Barber System e em quais casos há reembolso. Última atualização: ${company.policiesUpdatedAt}.`,
 body:`<h2>1. Inscrição não gera cobrança</h2>
<p>Fazer a inscrição no site ou conversar com a gente não contrata o plano nem autoriza nenhuma cobrança. A cobrança só começa depois que você contrata e autoriza o pagamento.</p>
<h2>2. Direito de arrependimento (7 dias)</h2>
<p>Como a contratação é feita pela internet, você pode desistir em até 7 dias corridos a partir da contratação ou do primeiro pagamento, conforme o artigo 49 do Código de Defesa do Consumidor. Nesse caso, devolvemos o valor pago integralmente, pelo mesmo meio de pagamento.</p>
<h2>3. Como cancelar</h2>
<p>Peça o cancelamento pelo e-mail ${mail} ou pelo ${wa}, informando o nome da barbearia e o e-mail da conta. Confirmamos o cancelamento por escrito em até 2 dias úteis.</p>
<h2>4. Cancelamento depois dos 7 dias</h2>
<ul>
<li>Não há multa nem fidelidade.</li>
<li>A cobrança recorrente é interrompida e não haverá novas cobranças.</li>
<li>O acesso continua até o fim do período já pago. Não há reembolso proporcional dos dias restantes do ciclo em curso.</li>
</ul>
<h2>5. Cobranças indevidas</h2>
<p>Se houver cobrança em duplicidade ou em valor diferente do contratado, avise pelo e-mail ${mail}. Depois de confirmada, a diferença é devolvida em até 10 dias úteis, pelo mesmo meio de pagamento. O prazo para o valor aparecer na fatura do cartão depende da operadora.</p>
<h2>6. O que acontece com os dados</h2>
<p>Depois do encerramento, os dados da barbearia ficam guardados por até 90 dias para permitir a reativação ou o envio de uma cópia, se você pedir. Depois disso, são excluídos ou anonimizados, exceto os registros que a lei obriga a manter. Veja a <a href="/politica-de-privacidade">Política de Privacidade</a>.</p>
<h2>7. Planos e pagamentos dos clientes da barbearia</h2>
<p>Cancelamentos e reembolsos de serviços ou planos vendidos pela barbearia aos clientes dela seguem as regras da própria barbearia, que é a responsável por essa relação.</p>`
},
{
 path:'/politica-de-cookies',
 title:'Política de Cookies | Barber System',
 h1:'Política de Cookies',
 eyebrow:'COOKIES E ARMAZENAMENTO',
 description:'Quais cookies e tecnologias de armazenamento o Barber System usa nas páginas públicas e no sistema, e como você controla a análise opcional.',
 lead:`Cookies e armazenamento local são pequenos dados guardados no seu navegador. Veja quais usamos e como controlar. Última atualização: ${company.policiesUpdatedAt}.`,
 body:`<h2>1. Necessários</h2>
<p>Usados para o site e o sistema funcionarem. Não podem ser desativados sem prejudicar o funcionamento.</p>
<ul>
<li><strong>Sessão de acesso</strong> (armazenamento local do navegador): mantém você conectado à sua conta no sistema.</li>
<li><strong>barber.analytics.consent.v1</strong> (armazenamento local): guarda a sua escolha sobre a análise das páginas públicas.</li>
</ul>
<h2>2. Análise (opcional)</h2>
<p>Só são ativados se você clicar em “Aceitar análise” no aviso de privacidade.</p>
<ul>
<li><strong>Google Analytics</strong> (cookies <code>_ga</code> e <code>_ga_*</code>): mostram de forma agregada quais páginas públicas e conteúdos do blog são mais visitados e quais botões recebem cliques. A área do sistema e as páginas das barbearias ficam fora dessa análise.</li>
</ul>
<h2>3. Como mudar sua escolha</h2>
<p>Clique no botão “Privacidade” no canto da tela, em qualquer página pública, para aceitar ou recusar a análise a qualquer momento. Você também pode apagar cookies e dados de sites nas configurações do seu navegador.</p>
<h2>4. Mais informações</h2>
<p>Veja como tratamos dados pessoais na <a href="/politica-de-privacidade">Política de Privacidade</a> e saiba como o Google usa dados de sites parceiros em <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">policies.google.com</a>. Dúvidas: ${mail}.</p>`
}
]

export function renderLegalPage(path:string) {
 const page = legalPages.find(p=>p.path===path)
 if(!page) return null
 const others = legalLinks.filter(l=>l.path!==path)
 const main = `<section class="legal-hero"><div class="section"><p class="eyebrow">${esc(page.eyebrow)}</p><h1>${esc(page.h1)}</h1><p class="lead">${esc(page.lead)}</p></div></section><section class="section legal-layout"><article class="legal-body">${page.body}</article><aside class="legal-aside"><p class="eyebrow">MAIS INFORMAÇÕES</p><nav aria-label="Páginas institucionais">${others.map(l=>`<a href="${l.path}">${esc(l.label)}</a>`).join('')}</nav><div class="legal-aside-company"><strong>${esc(company.legalName)}</strong><span>CNPJ ${esc(company.cnpj)}</span><span>${esc(company.city)}/${esc(company.state)}</span></div></aside></section>`
 const schema = {'@context':'https://schema.org','@graph':[{'@type':page.type||'WebPage',name:page.title,description:page.description,url:origin+page.path,inLanguage:'pt-BR',isPartOf:{'@type':'WebSite',name:'Barber System',url:origin},publisher:{'@id':`${origin}/#organizacao`}},organizationSchema()]}
 return renderPublicShell({title:page.title,description:page.description,path:page.path,bodyClass:'legal',main,schema})
}
