// Read-only normalization. Private source files stay outside the repository.
import fs from 'node:fs/promises'
import path from 'node:path'
const dir=path.resolve(process.argv[2]); const files=await fs.readdir(dir)
const read=async name=>JSON.parse(await fs.readFile(path.join(dir,name+'.json'),'utf8'))
const unwrap=v=>{while(v&&!Array.isArray(v)&&v.data!==undefined)v=v.data;return v}
const cents=v=>Math.round(Number(String(v??0).replace(',','.'))*100)
const str=v=>v==null?'':String(v)
const key=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()
const phone=v=>str(v).replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'')
const unique=rows=>[...new Map(rows.map(r=>[str(r.id),r])).values()]
const out={}
const appointments=unique((await Promise.all(files.filter(n=>/^agendamentos-\d{4}-\d{2}\.json$/.test(n)).map(async n=>unwrap(JSON.parse(await fs.readFile(path.join(dir,n),'utf8')))))).flat())
const orders=unique((await Promise.all(files.filter(n=>/^comandas-(\d{3}|pagina-\d+)\.json$/.test(n)).map(async n=>unwrap(JSON.parse(await fs.readFile(path.join(dir,n),'utf8')))))).flat())
const clients=unique([...unwrap(await read('clientes-export')),...appointments.map(a=>a.cliente).filter(Boolean),...orders.map(o=>o.cliente).filter(Boolean)])
const staff=unwrap(await read('profissionais-completo'))
const serviceRows=unwrap(await read('servicos-completo'))
const products=unwrap(await read('produtos-completo'))
const detailObjects=await Promise.all(files.filter(n=>/^agenda-detalhes-\d{4}-\d{2}\.json$/.test(n)).map(async n=>{let d=JSON.parse(await fs.readFile(path.join(dir,n),'utf8')).data;return d.data??d}))
const details=unique(detailObjects.flatMap(o=>o.agendamentos||[]))
const detailMap=new Map(details.map(a=>[str(a.id),a]));const orderMap=new Map(orders.map(o=>[str(o.id),o]))
const clientFor=(name,tel)=>{let matched=clients.filter(c=>key(c.cli_name)===key(name)&&(!phone(tel)||phone(c.cli_telefone)===phone(tel))); if(matched.length===1)return str(matched[0].id);if(phone(tel)){matched=clients.filter(c=>phone(c.cli_telefone)===phone(tel));if(matched.length===1)return str(matched[0].id)}return null}
out.clients=clients.map(c=>({id:str(c.id),name:str(c.cli_name).trim(),email:c.email,phone:c.cli_telefone,created:c.created_at,notes:c.cli_anotacao||null,source_profile:{birth_date:c.cli_data_nascimento,cpf:c.cli_cpf,address:{street:c.cli_logradouro,number:c.cli_numero,district:c.cli_bairro,city:c.cli_cidade,state:c.cli_estado}}}))
const photoMap=new Map(detailObjects.flatMap(o=>o.barbeiros||[]).filter(b=>b.foto?.url).map(b=>[str(b.id),b.foto.url]))
out.memberships=staff.map(s=>({id:str(s.id),name:str(s.usu_nome_app||s.usu_name).trim(),email:s.email,role:s.usu_type==='BARBEIRO'?'barber':'admin',source_active:!!s.usu_active,created:s.created_at,photo_url:photoMap.get(str(s.id))||null}))
out.services=serviceRows.map(s=>({id:str(s.id),name:str(s.ser_nome).trim(),duration:Number(s.ser_duracao),price:cents(s.ser_valor),active:!!s.ser_active,created:s.created_at,extra_service:s.ser_id_categoria===14011,category_id:s.ser_id_categoria}))
out.products=products.map(p=>({id:str(p.id),name:str(p.pro_nome).trim(),sku:p.pro_sku,category:p.pro_id_categoria===14013?(/sab[aã]o/i.test(p.pro_nome)?'supply':'bar'):'retail',price:cents(p.pro_valor),stock:Number(p.pro_estoque_atual||0),active:!!p.pro_active,created:p.created_at,category_id:p.pro_id_categoria,source_profile:{ncm:p.pro_ncm,gtin:p.pro_gtin,cest:p.pro_cest,minimum_stock:p.pro_estoque_minimo}}))
out.appointments=appointments.map(a=>({id:str(a.id),client:str(a.age_id_cliente),barber:str(a.age_id_user),start:a.age_inicio,end:a.age_fim,status:{Finalizado:'completed',Cancelado:'cancelled',Agendado:'confirmed'}[a.age_status]||'pending',created:a.created_at,notes:a.age_observacao||null,source_status:a.age_status,source_active:!!a.age_active,source_client_status:a.age_cliente_status,has_plan:!!detailMap.get(str(a.id))?.has_plan}))
out.appointment_services=details.flatMap(a=>(a.agendamento_servicos||[]).map(s=>({id:str(s.id),appointment:str(a.id),service:str(s.ags_id_servico),name:s.servico?.ser_nome})))
const dayMap={Domingo:0,Segunda:1,'Terça':2,Quarta:3,Quinta:4,Sexta:5,'Sábado':6}
out.availability_rules=unique(detailObjects.flatMap(o=>(o.barbeiros||[]).flatMap(b=>(b.user_horarios||[]).map(h=>({id:str(h.id),barber:str(h.ush_id_user),weekday:dayMap[h.ush_dia],start:h.ush_hora_inicio,end:h.ush_hora_fim,created:h.created_at})))))
// Breaks and time off are archived exactly. A single native exception cannot represent multiple daily breaks.
out.availability_blocks=unique(detailObjects.flatMap(o=>[...(o.intervalos||[]).map(b=>({...b,source_kind:'interval'})),...(o.folgas||[]).map(b=>({...b,source_kind:'day_off'})),...(o.agendamentos||[]).filter(a=>!a.id_cliente&&!a.age_id_cliente&&a.title==='Bloqueado').map(b=>({id:b.id,title:'Bloqueado',start:b.start,end:b.end,id_barbeiro:b.id_barbeiro,source_kind:'blocked_slot'}))]).map(b=>({...b,id:str(b.id)+':'+b.source_kind+':'+b.start})))
const revenues=unique((await Promise.all(files.filter(n=>/^faturamento-\d{4}-\d{2}\.json$/.test(n)).map(async n=>unwrap(JSON.parse(await fs.readFile(path.join(dir,n),'utf8')))))).flat().map(r=>({...r,id:(r.valor_assinatura!==undefined?'subscription:':'order:')+r.id})))
out.payments=revenues.map(r=>{const sub=r.valor_assinatura!==undefined;const order=orderMap.get(str(r.comanda_id));return {id:r.id,client:sub?clientFor(r.cliente,r.telefone):str(order?.com_id_cliente)||clientFor(r.cliente,r.telefone),amount:cents(sub?r.valor_assinatura:r.valor),paid_at:sub?r.data_pagamento_assinatura:r.data_pagamento,method:/pix/i.test(r.forma_pagamento)?'pix':/dinheiro/i.test(r.forma_pagamento)?'cash':/cart|cr[eé]dito|d[eé]bito/i.test(r.forma_pagamento)?'card':'other',source_kind:sub?'subscription':'order',source_status:r.status_assinatura||'paid',source_active:sub?r.active_assinatura!==0:order?.com_active!==0,order_id:r.comanda_id?str(r.comanda_id):null,services:cents(r.valor_servicos),products:cents(r.valor_produtos),source_record:r}})
out.expenses=unwrap(await read('despesas-todas')).map(e=>({id:str(e.id),category:e.categoria?.caf_nome||'Despesa importada',description:e.mov_descricao||'Despesa Cashbarber',amount:cents(e.mov_valor),occurred_on:str(e.mov_data_pagamento_recebimento||e.mov_data_vencimento).slice(0,10),paid:!!e.mov_pago,active:!!e.mov_active,cost_kind:/comiss/i.test(e.categoria?.caf_nome)?'commission':/taxa/i.test(e.categoria?.caf_nome)?'fees':'operating',source_record:e}))
out.orders=orders.map(o=>({id:str(o.id),client:str(o.com_id_cliente),total:cents(o.total_liquido),paid:cents(o.com_valor_pago),paid_at:o.paid_at,active:!!o.com_active,source_record:{...o,cliente:undefined}}))
out.plans=unwrap(await read('planos-simpleList')).map(p=>({id:str(p.id),name:p.pla_nome,price:cents(p.pla_valor),active:!!p.pla_active,source_record:p}))
out.contracts=unwrap(await read('contratos-ativos')).map(c=>({id:str(c.id),name:c.cli_name,email:c.email,phone:c.cli_telefone,plan:c.pla_nome,price:cents(c.clp_valor??c.pla_valor),starts_on:c.clp_data_inicio,status:c.status,provider:c.tipo_cobranca,client:clientFor(c.cli_name,c.cli_telefone),source_record:c}))
out.overdue=unwrap(await read('assinaturas-inadimplentes')).map(c=>({id:str(c.id),source_record:c}))
out.sales_summary=(await Promise.all(files.filter(n=>/^vendas-\d{4}-\d{2}\.json$/.test(n)).map(async n=>{let r=JSON.parse(await fs.readFile(path.join(dir,n),'utf8'));while(r.data!==undefined)r=r.data;let month=n.slice(7,14);return [...(r.servicos||[]).map(s=>({id:month+':service:'+s.ags_id_servico,month,kind:'service',source_item:str(s.ags_id_servico),name:s.ser_nome,quantity:Number(s.count),amount:cents(s.sum)})),...(r.produtos||[]).map(p=>({id:month+':product:'+p.cop_id_produto,month,kind:'product',source_item:str(p.cop_id_produto),name:p.pro_nome,quantity:Number(p.count),amount:cents(p.total)}))]}))).flat()
out.receivables=unique((await Promise.all(files.filter(n=>/^recebiveis-\d{4}-\d{2}\.json$/.test(n)).map(async n=>unwrap(JSON.parse(await fs.readFile(path.join(dir,n),'utf8')))))).flat()).map(r=>({id:str(r.id),source_record:r}))
out.product_history=(await Promise.all(files.filter(n=>/^produtos-historico-\d{4}-\d{2}\.json$/.test(n)).map(async n=>unwrap(JSON.parse(await fs.readFile(path.join(dir,n),'utf8'))).map((r,i)=>({id:n.match(/\d{4}-\d{2}/)[0]+':'+i,source_record:r}))))).flat()
const target=path.join(dir,'normalized');await fs.mkdir(target,{recursive:true})
for(const [dataset,rows]of Object.entries(out))await fs.writeFile(path.join(target,dataset+'.json'),JSON.stringify(rows),'utf8')
const summary=Object.fromEntries(Object.entries(out).map(([k,v])=>[k,{rows:v.length,...(k==='payments'?{amount:v.filter(p=>p.source_active&&['paid','payExternal'].includes(p.source_status)).reduce((s,p)=>s+p.amount,0),unmapped:v.filter(p=>!p.client).length}:{})}]))
await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))
