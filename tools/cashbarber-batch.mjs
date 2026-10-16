import fs from 'node:fs/promises'
import path from 'node:path'
const [dir,shop,dataset,offset,size]=process.argv.slice(2)
const rows=JSON.parse(await fs.readFile(path.join(dir,dataset+'.json'),'utf8')).slice(Number(offset),Number(offset)+Number(size))
const json=JSON.stringify(rows).replaceAll("'","''")
process.stdout.write(`select app_private.import_cashbarber_batch('${shop}'::uuid,'${dataset}','${json}'::jsonb);`)
