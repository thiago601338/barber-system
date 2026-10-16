import { useCallback, useEffect, useRef, useState } from 'react'
import type { Role } from '../types'
import { readFinishedTours, readSavedTourRun, tourStorageKey, validSavedTourRun, type SavedTourRun } from '../tour'
import { requireSupabase } from './supabase'

function storeProgress(key:string,run:SavedTourRun|null,finished:string[]):boolean {
  try {
    if(run)localStorage.setItem(`${key}:run`,JSON.stringify(run));else localStorage.removeItem(`${key}:run`)
    localStorage.setItem(key,JSON.stringify(finished));return true
  } catch { return false }
}

export function useTourProgress(userId: string | undefined, shopId: string | undefined, role: Role) {
  const key = userId ? tourStorageKey(userId, shopId, role) : ''
  const [state,setState] = useState<{ key:string; run:SavedTourRun|null; finished:string[]; loading:boolean; error:string|null }>({key:'',run:null,finished:[],loading:false,error:null})
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const revision = useRef(0)
  const context = useRef(key)
  const latest = useRef(state)
  context.current=key
  latest.current=state
  useEffect(()=>{
    if(!key || !userId) return
    let active=true
    const loadRevision=revision.current
    const local=readSavedTourRun(key), finished=readFinishedTours(key)
    setState({key,run:local,finished,loading:true,error:null})
    let query=requireSupabase().from('guided_tour_runs').select('run,finished_chapters,updated_at').eq('user_id',userId).eq('role',role)
    query=shopId?query.eq('barbershop_id',shopId):query.is('barbershop_id',null)
    void Promise.resolve(query.maybeSingle()).then(({data,error})=>{
      if(!active)return
      // Opening or advancing a guide while the request is pending must keep
      // the new run. The response only describes the state before that action.
      if(revision.current!==loadRevision){setState(current=>current.key===key?{...current,loading:false}:current);return}
      if(error){setState({key,run:local,finished,loading:false,error:'Não foi possível sincronizar o progresso agora. Seu treino pode continuar.'});return}
      const server=validSavedTourRun(data?.run)
      const useLocal=!!local&&(!data?.updated_at||local.updatedAt>data.updated_at)
      const run=useLocal?local:server||null
      const remote=Array.isArray(data?.finished_chapters)?data.finished_chapters.filter((id:unknown):id is string=>typeof id==='string'):[]
      const merged=[...new Set([...finished,...remote])]
      const stored=storeProgress(key,run,merged)
      setState({key,run,finished:merged,loading:false,error:stored?null:'Este navegador não permite salvar o progresso neste dispositivo.'})
    }).catch(()=>{
      if(active)setState(current=>current.key===key?{...current,loading:false,error:'A sincronização não está disponível agora. Seu treino pode continuar.'}:current)
    })
    return()=>{active=false}
  },[key,userId,shopId,role])
  const save=useCallback((run:SavedTourRun|null,finished?:string[])=>{
    if(!key || !userId)return
    revision.current+=1
    const completed=finished||(latest.current.key===key?latest.current.finished:readFinishedTours(key))
    const stored=storeProgress(key,run,completed)
    const nextState={key,run,finished:completed,loading:false,error:stored?null:'Este navegador não permite salvar o progresso neste dispositivo. A sincronização será tentada.'}
    latest.current=nextState;setState(nextState)
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      if(context.current!==key)return
      try {
        const {error}=await requireSupabase().rpc('save_guided_tour',{p_shop:shopId||null,p_role:role,p_run:run,p_finished:completed})
        if(error)throw error
      } catch {
        setState(current=>current.key===key?{...current,error:stored?'Progresso salvo neste dispositivo; a sincronização será retomada ao abrir o guia.':'A sincronização e o armazenamento neste dispositivo não estão disponíveis. Mantenha o guia aberto para continuar.'}:current)
      }
    })
  },[key,userId,shopId,role])
  return {run:state.key===key?state.run:null,finished:state.key===key?state.finished:[],loading:state.key===key&&state.loading,error:state.key===key?state.error:null,save}
}
