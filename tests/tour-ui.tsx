import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { GuidedTour } from '../src/GuidedTour'
import type { TourStep } from '../src/tour'
import '../src/styles.css'
import '../src/styles-premium.css'
import '../src/styles-brand.css'
import '../src/styles-report.css'
import '../src/styles-tour.css'
import '../src/styles-responsive.css'

// Local fixture: no account, provider call or database write is involved.
localStorage.setItem('barber-guided-tour-audio:v1', 'off')
const normalSteps: TourStep[] = [
  { module: 'clients', kind: 'content', selector: '[data-test="open"]', title: 'Abra o cadastro de teste', description: 'O próximo passo só deve ser liberado quando o formulário aparecer.', practice: { instruction: 'Abra o formulário.', completeOn: 'click', openedSelector: '[data-test="form"]' } },
  { module: 'clients', kind: 'content', selector: '[data-test="name"]', title: 'Digite sem perder o foco', description: 'As setas devem mover o cursor no campo. Não devem avançar o guia.', practice: { instruction: 'Digite um nome fictício.', completeOn: 'input' } },
  { module: 'clients', kind: 'content', selector: '[data-test="unavailable"]', title: 'Recurso indisponível', description: 'Pular não deve marcar um teste como concluído.', practice: { instruction: 'Esta etapa foi deixada indisponível de propósito.', completeOn: 'click' } },
]
const mode=new URLSearchParams(location.search).get('mode')
const quiz:TourStep={module:'clients',kind:'content',selector:'[data-test="quiz-target"]',title:'Confirme o aprendizado',description:'Uma resposta errada não libera a conclusão.',practice:{instruction:'Escolha a resposta correta.',completeOn:'quiz',quiz:{question:'O treino salva clientes reais?',choices:['Sim, automaticamente','Não, apenas valida os campos'],correct:1,explanation:'Correto: nenhum registro real foi salvo.'}}}
const steps: TourStep[] = mode==='form' ? [normalSteps[0],{module:'clients',kind:'content',selector:'[data-test="form"]',title:'Valide os campos de treino',description:'Confira os obrigatórios e o intervalo de atendimento.',practice:{instruction:'Altere um campo, valide e feche o formulário.',completeOn:'valid_form',openedSelector:'[data-test="form"]'}},quiz]
  : mode==='quiz'?[quiz]:mode==='actions'?[{module:'clients',kind:'content',selector:'[data-test="actions"]',title:'Nenhuma ação real',description:'Confirmação, envio, entrega e permissões devem ser interceptados.',practice:{instruction:'Confira os controles sem gravar dados.',completeOn:'click'}}]
  : new URLSearchParams(location.search).has('close')
  ? [normalSteps[0], { module: 'clients', kind: 'content', selector: '[data-test="open"]', title: 'Outra atividade fora do formulário', description: 'A janela anterior precisa ser concluída ou cancelada antes de mudar de atividade.', practice: { instruction: 'Clique no botão de teste.', completeOn: 'click' } }]
  : normalSteps

function Fixture() {
  const [opened, setOpened] = useState(false)
  const [name, setName] = useState('')
  const [index, setIndex] = useState(0)
  const [finished, setFinished] = useState(false)
  const [result, setResult] = useState<string[]>([])
  const [start,setStart]=useState('09:00'),[end,setEnd]=useState('18:00')
  const [writes,setWrites]=useState(0)
  const [submitDisabled,setSubmitDisabled]=useState(false)
  return <div className="main-area" style={{ padding: 40, fontFamily: 'Arial' }}>
    <div className="content">
    <h1>Verificação controlada do tutorial</h1>
    <p>Sem salvar dados de clientes.</p>
    <button data-test="open" onClick={() => window.setTimeout(()=>setOpened(true),100)} style={{ padding: 18 }}>Abrir formulário de teste</button>
    {opened && <div className="modal" style={{marginTop:24}}><form data-test="form" onSubmit={event => {event.preventDefault();setWrites(n=>n+1)}} style={{display:'grid',gap:16,width:'min(400px, 100%)',padding:24,border:'1px solid #aac',background:'#fff'}}>
      <label>Nome fictício <input data-test="name" aria-label="Nome fictício" required value={name} onChange={event => setName(event.target.value)} /></label>
      {mode==='form'&&<><label>Início <input aria-label="Início" type="time" required value={start} onChange={event=>setStart(event.target.value)}/></label><label>Fim <input aria-label="Fim" type="time" required value={end} onChange={event=>setEnd(event.target.value)}/></label><label><input type="checkbox" aria-label="Simular cadastro pendente" checked={submitDisabled} onChange={event=>setSubmitDisabled(event.target.checked)}/>Simular cadastro pendente</label><label>Imagem <input type="file" aria-label="Imagem de treino"/></label><button type="submit" disabled={submitDisabled}>Salvar cliente</button></>}
      <button type="button" aria-label="Fechar" onClick={() => setOpened(false)}>Fechar formulário</button>
    </form></div>}
    <section data-test="quiz-target" style={{padding:18,marginTop:22,border:'1px solid #bcc'}}>Resumo de aprendizado</section>
    {mode==='actions'&&<section data-test="actions" style={{padding:24,display:'grid',gap:12,border:'1px solid #bbb'}}><h2>Controles de teste</h2><button onClick={()=>setWrites(n=>n+1)}>Confirmar ação</button><button onClick={()=>setWrites(n=>n+1)}>Entregar</button><button className="permission-toggle" aria-label="Liberar Agenda" onClick={()=>setWrites(n=>n+1)}>✓</button><form onSubmit={event=>{event.preventDefault();setWrites(n=>n+1)}}><button type="submit">Continuar teste de envio</button></form></section>}
    <output aria-label="Gravações de teste">{writes}</output>
    <output aria-label="Resultado da verificação">{result.join(' | ')}</output>
    </div>
    {!finished && <GuidedTour steps={steps} index={index} onBack={() => setIndex(current => Math.max(0, current - 1))} onNext={(completed = true) => { setResult(current => [...current, `etapa ${index + 1}: ${completed ? 'concluída' : 'pulada'}`]); if (index === steps.length - 1) setFinished(true); else setIndex(current => current + 1) }} onClose={() => setFinished(true)}/>} 
  </div>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
