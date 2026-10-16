import fs from 'node:fs/promises'
import path from 'node:path'
const dir = process.argv[2]
const unwrap = v => { while (v && !Array.isArray(v) && v.data !== undefined) v = v.data; return v }
for (const name of ['clientes-export','servicos-completo','produtos-completo','profissionais-completo','comandas-000','faturamento-2026-09','despesas-todas','recebiveis-todos']) {
  try { const raw=JSON.parse(await fs.readFile(path.join(dir,name+'.json'),'utf8')); const rows=unwrap(raw); console.log(JSON.stringify({name,count:rows.length,keys:Object.keys(rows[0]||{}),nested:Object.fromEntries(Object.entries(rows[0]||{}).filter(([,v])=>v&&typeof v==='object').map(([k,v])=>[k,Object.keys(v)])),statuses:[...new Set(rows.map(r=>r.status_assinatura||r.mov_tipo||r.status||'').filter(Boolean))],zero:rows.filter(r=>r.valor===0).length,negative:rows.filter(r=>Number(r.valor||r.mov_valor)<0).length})); } catch(e) { console.log(name+': '+e.message) }
}
