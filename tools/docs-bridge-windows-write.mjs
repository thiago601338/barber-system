import fs from 'node:fs/promises'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'

const root=path.resolve('../verification/backlink-covers-20261005')
const encoded=process.argv[2]
if(!encoded||!/^[A-Za-z0-9+/=]+$/.test(encoded))throw Error('Expected compressed image-document artifacts')
const files=JSON.parse(gunzipSync(Buffer.from(encoded,'base64')).toString('utf8'))
if(!Array.isArray(files))throw Error('Expected an artifact batch')
const checked=files.map(file=>{
 const destination=path.resolve(file.path.replace(/^\/([A-Za-z]:\/)/,'$1'))
 if(!destination.startsWith(root+path.sep)||typeof file.text!=='string')throw Error('Artifact is outside the approved document workspace')
 return {path:destination,text:file.text}
})
for(const file of checked){await fs.mkdir(path.dirname(file.path),{recursive:true});await fs.writeFile(file.path,file.text,'utf8')}
console.log(JSON.stringify({written:checked.length}))
