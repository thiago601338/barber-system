import { useState, type FormEvent } from 'react'
import { requireSupabase } from '../lib/supabase'
import { useRows } from '../lib/useRows'
import { Field, Loading, Notice, Panel, PrimaryButton } from '../ui'
import { problemMessage } from './BookingEnhancements'

export function ClientProfilePanel({shopId,clientId,email}:{shopId:string;clientId:string;email?:string}){
 const rows=useRows('clients',shopId,true,'created_at',{id:clientId})
 const person=rows.rows.find(r=>r.id===clientId)
 const [edit,setEdit]=useState(false),[name,setName]=useState(''),[phone,setPhone]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[error,setError]=useState<string|null>(null)
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError(null);setMessage(null);try{const r=await requireSupabase().rpc('update_client_profile',{p_shop:shopId,p_client:clientId,p_full_name:name.trim(),p_phone:phone.trim()||null});if(r.error)throw r.error;await rows.refresh();setEdit(false);setMessage('Seus dados foram atualizados.')}catch(p){setError(problemMessage(p,'Não foi possível atualizar seu cadastro.'))}finally{setBusy(false)}}
 return <Panel title="Meus dados" subtitle="Atualize como a barbearia identifica e entra em contato com você."><Notice text={rows.error||error}/><Notice text={message} kind="success"/>{rows.loading?<Loading/>:person&&<>{edit?<form className="form-grid" onSubmit={save}><Field label="Nome completo"><input required minLength={2} maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></Field><Field label="Telefone com DDD"><input type="tel" maxLength={50} value={phone} onChange={e=>setPhone(e.target.value)}/></Field><p className="muted">E-mail de acesso: {email || 'não informado'}. O e-mail de login não é alterado por este formulário.</p><div className="form-actions"><button className="button ghost" type="button" onClick={()=>setEdit(false)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy?'Salvando...':'Salvar meus dados'}</PrimaryButton></div></form>:<><div className="detail-list"><div><span>Nome</span><strong>{String(person.full_name)}</strong></div><div><span>Telefone</span><strong>{String(person.phone||'Não informado')}</strong></div><div><span>E-mail de acesso</span><strong>{email || 'Não informado'}</strong></div></div><button className="button outline" type="button" onClick={()=>{setName(String(person.full_name||''));setPhone(String(person.phone||''));setEdit(true);setMessage(null);setError(null)}}>Editar meus dados</button></>}</>}</Panel>
}
