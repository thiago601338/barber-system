if(location.hash.includes('access_token=')||location.hash.includes('type=recovery')||location.hash.includes('type=invite'))location.replace('/entrar'+location.search+location.hash)
const menuToggle=document.querySelector('.nav-toggle'),publicNav=document.querySelector('#public-nav')
if(menuToggle&&publicNav){
 const setMenu=open=>{publicNav.classList.toggle('is-open',open);menuToggle.setAttribute('aria-expanded',String(open));menuToggle.setAttribute('aria-label',open?'Fechar navegação':'Abrir navegação')}
 menuToggle.addEventListener('click',()=>setMenu(menuToggle.getAttribute('aria-expanded')!=='true'))
 publicNav.addEventListener('click',event=>{if(event.target.closest('a[href]'))setMenu(false)})
 document.addEventListener('click',event=>{if(!event.target.closest('.site-header'))setMenu(false)})
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menuToggle.getAttribute('aria-expanded')==='true'){setMenu(false);menuToggle.focus()}})
 window.addEventListener('resize',()=>{if(window.innerWidth>850)setMenu(false)})
}
const calculator=document.querySelector('#margin-demo')
if(calculator)calculator.addEventListener('input',()=>{
 const price=Number(calculator.elements.price.value),cost=Number(calculator.elements.cost.value)
 const out=calculator.querySelector('output')
 if(!calculator.checkValidity()||!Number.isFinite(price)||!Number.isFinite(cost)||price<=0){out.textContent='Coloque um preço maior que zero e confira os gastos.';return}
 out.textContent=`Contribuição: ${(price-cost).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} · ${((price-cost)/price*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}% do preço.`
})
const pricingDemo=document.querySelector('#pricing-demo')
if(pricingDemo){
 const base=Number(pricingDemo.dataset.baseCents),unit=Number(pricingDemo.dataset.barberCents),cap=Number(pricingDemo.dataset.capCents)
 const seats=pricingDemo.elements.seats,out=pricingDemo.querySelector('output'),equation=pricingDemo.querySelector('#pricing-equation')
 const money=cents=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
 const updatePrice=()=>{
  const count=Number(seats.value),subtotal=base+count*unit
  pricingDemo.querySelectorAll('[data-seats]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.seats)===count)))
  if(!pricingDemo.checkValidity()||![base,unit,cap,count,subtotal].every(Number.isSafeInteger)||base<0||unit<0||cap<0||count<1||count>500){out.textContent='Informe de 1 a 500 profissionais.';equation.textContent='Use um número inteiro, como 1, 2 ou 3.';return}
  const total=cap>0?Math.min(subtotal,cap):subtotal
  out.textContent=money(total)+' /mês'
  equation.textContent=money(base)+' + '+count+' × '+money(unit)+(subtotal>total?' · redução pelo teto: '+money(subtotal-total):'')
 }
 pricingDemo.addEventListener('input',updatePrice)
 pricingDemo.addEventListener('submit',event=>{event.preventDefault();updatePrice()})
 pricingDemo.querySelectorAll('[data-seats]').forEach(button=>button.addEventListener('click',()=>{seats.value=button.dataset.seats;updatePrice()}))
}
const signup=document.querySelector('#signup-form')
if(signup){
 const status=signup.querySelector('.signup-status'),submit=signup.querySelector('button[type=submit]'),f=signup.elements
 const say=(text,kind='')=>{status.textContent=text;status.className='signup-status '+kind}
 signup.addEventListener('input',event=>{if(event.target.getAttribute('aria-invalid'))event.target.removeAttribute('aria-invalid')})
 signup.addEventListener('submit',async event=>{
  event.preventDefault()
  const phone=f.phone.value.replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'')
  signup.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'))
  const invalid=[f.full_name,f.email,f.business_name].filter(el=>!el.value.trim()||!el.checkValidity())
  if(phone.length<10||phone.length>11)invalid.push(f.phone)
  if(invalid.length){invalid.forEach(el=>el.setAttribute('aria-invalid','true'));invalid[0].focus();say('Confira os campos destacados. O WhatsApp precisa ter DDD.','err');return}
  if(!f.consent.checked){f.consent.focus();say('Marque a autorização para podermos responder à sua inscrição.','err');return}
  submit.disabled=true;say('Enviando sua inscrição...')
  try{
   const response=await fetch('/api/platform-leads/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({full_name:f.full_name.value.trim(),email:f.email.value.trim(),phone:'55'+phone,business_name:f.business_name.value.trim(),profile_type:f.profile_type.value,team_size:Number(f.team_size.value),source_path:signup.dataset.source,consent:true,website:f.website.value})})
   const data=await response.json().catch(()=>({}))
   if(!response.ok)throw new Error(data.error||'Não foi possível enviar agora. Tente de novo em instantes.')
   signup.classList.add('done');say('Inscrição recebida! Em breve a gente fala com você pelo WhatsApp ou pelo e-mail informado.','ok')
   if(typeof window.gtag==='function')window.gtag('event','generate_lead',{source_path:signup.dataset.source})
  }catch(error){say(error instanceof Error?error.message:'Não foi possível enviar agora.','err')}
  finally{submit.disabled=false}
 })
}
