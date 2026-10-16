const assert=require('node:assert/strict'),test=require('node:test')
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`

test('operational permissions separate master, shop administrators, barber modules and customers',async()=>{
 const {actionsForProfile}=await import('../netlify/functions/_shared/aiHelpAccess.ts')
 assert.deepEqual(actionsForProfile('master',false,[]),['create_shop'])
 assert(actionsForProfile('admin',true,[]).includes('update_product'))
 assert.deepEqual(actionsForProfile('barber',true,[]),[])
 assert.deepEqual(actionsForProfile('barber',true,['ai','appointments','clients']),['book_appointment','create_client','update_client'])
 assert(!actionsForProfile('barber',true,['ai','services','products']).includes('update_service'))
})
test('operational proposal rejects invented identifiers, duplicate services and missing time zones',async()=>{
 const {validateHelpAction}=await import('../netlify/functions/_shared/aiHelpActions.ts')
 const values={client_id:id(1),barber_membership_id:id(2),service_ids:[id(3)],starts_at:'2027-01-02T10:00:00-03:00'}
 assert.equal(validateHelpAction({type:'book_appointment',values},['book_appointment']).action.values.starts_at,'2027-01-02T13:00:00.000Z')
 for(const bad of [{client_id:'invented'},{service_ids:[id(3),id(3)]},{starts_at:'2027-01-02T10:00:00'}])assert.throws(()=>validateHelpAction({type:'book_appointment',values:{...values,...bad}},['book_appointment']))
})
test('nonfinancial product updates cannot smuggle money, stock, photos or subscription rules',async()=>{
 const {validateHelpAction}=await import('../netlify/functions/_shared/aiHelpActions.ts')
 const values={id:id(1),expected_updated_at:'2026-10-05T15:00:00Z',name:'Novo nome'}
 for(const field of ['price_cents','cost_cents','stock_quantity','tax_pct','fee_pct','commission_pct','requires_subscription','image_url','image_path'])assert.throws(()=>validateHelpAction({type:'update_product',values:{...values,[field]:1}},['update_product']))
 assert.deepEqual(Object.keys(validateHelpAction({type:'update_product',values},['update_product']).action.values),['id','expected_updated_at','name'])
 assert.throws(()=>validateHelpAction({type:'update_product',values},['create_personal_goal']))
})
test('an update needs a version and at least one change; block boundaries are validated',async()=>{
 const {validateHelpAction}=await import('../netlify/functions/_shared/aiHelpActions.ts')
 assert.throws(()=>validateHelpAction({type:'update_client',values:{id:id(1),full_name:'Nome'}},['update_client']))
 assert.throws(()=>validateHelpAction({type:'update_service',values:{id:id(1),expected_updated_at:'2026-10-05T15:00:00Z'}},['update_service']))
 const block={barber_membership_id:id(1),starts_at:'2027-01-02T12:00:00Z',ends_at:'2027-01-02T11:00:00Z',reason:'Pausa'}
 assert.throws(()=>validateHelpAction({type:'create_schedule_block',values:block},['create_schedule_block']))
})
test('action options only read the own assigned client list and never contacts, costs or other products',async()=>{
 const {loadHelpOptions}=await import('../netlify/functions/_shared/aiHelpOptions.ts')
 const calls=[];const tables={client_barbers:[{barbershop_id:id(10),barber_membership_id:id(20),client_id:id(30)},{barbershop_id:id(10),barber_membership_id:id(21),client_id:id(31)}],
 clients:[{id:id(30),barbershop_id:id(10),full_name:'Meu cliente',email:'private@example.invalid',phone:'555000',updated_at:'2026-10-05T00:00:00Z'},{id:id(31),barbershop_id:id(10),full_name:'Outro cliente'}],memberships:[{id:id(20),barbershop_id:id(10),role:'barber',active:true,display_name:'Meu perfil'}],services:[{id:id(40),barbershop_id:id(10),name:'Corte',cost_cents:100}],products:[]}
 const client={from(table){const filters=[];let columns;calls.push({table,get columns(){return columns}});const q={select(value){columns=value;return q},eq(key,value){filters.push(row=>row[key]===value);return q},in(key,values){filters.push(row=>values.includes(row[key]));return q},order(){return q},limit(){return q},then(resolve,reject){return Promise.resolve({data:(tables[table]||[]).filter(row=>filters.every(f=>f(row))).map(row=>Object.fromEntries(columns.split(',').map(key=>[key,row[key]]))),error:null}).then(resolve,reject)}};return q}}
 const result=await loadHelpOptions(client,{role:'barber',shopId:id(10),shopName:'Teste',memberId:id(20),modules:['ai','appointments','clients'],allowed:['book_appointment','update_client'],dailyLimit:10,timezone:'UTC'})
 assert.deepEqual(result.clients.map(row=>row.id),[id(30)])
 assert.equal(result.clients[0].phone,undefined);assert.equal(result.clients[0].email,undefined)
 assert.equal(calls.some(call=>call.table==='products'),false);assert.equal(result.services[0].cost_cents,undefined)
})
