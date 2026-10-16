import type { SupabaseClient } from '@supabase/supabase-js'
import { getTourChapters, type TourStep } from '../../../src/tour.ts'
import { moduleLabels, type ModuleKey, type Role } from '../../../src/types.ts'
import { HttpError } from './core.ts'

export interface TutorialAccess { role: Role; modules: ModuleKey[]; hasShop: boolean }
const allModules = Object.keys(moduleLabels) as ModuleKey[]

function narrationBody(step: TourStep): string {
  return `${step.title}. ${step.description}${step.practice ? ` Teste prático: ${step.practice.instruction}` : ''}`
}

export function uniqueTutorialTexts(): string[] {
  const contexts: TutorialAccess[] = [
    { role: 'master', modules: ['ai'], hasShop: false },
    { role: 'master', modules: allModules, hasShop: true },
    { role: 'admin', modules: allModules, hasShop: true },
    { role: 'barber', modules: allModules, hasShop: true },
    { role: 'client', modules: [], hasShop: true },
  ]
  return [...new Set(contexts.flatMap(context =>
    getTourChapters(context.role, context.modules, context.hasShop).flatMap(chapter =>
      chapter.steps.map(step => step.audioText || narrationBody(step)))))]
}

export function isTutorialTextAllowed(tutorialText: string, contexts: TutorialAccess[]): boolean {
  if (contexts.some(context => getTourChapters(context.role, context.modules, context.hasShop)
    .some(chapter => chapter.steps.some(step => step.audioText === tutorialText)))) return true
  const match = /^Etapa (\d{2,3}) de (\d{2,3})\. ([\s\S]+)$/.exec(tutorialText)
  if (!match) return false
  const index = Number(match[1])
  const total = Number(match[2])
  if (index < 1 || index > total || String(index).padStart(2, '0') !== match[1]
    || String(total).padStart(2, '0') !== match[2]) return false
  // Users can run one chapter or several together. The spoken body must remain
  // an exact catalog step; only its bounded position in the combined guide varies.
  return contexts.some(context => {
    const steps = getTourChapters(context.role, context.modules, context.hasShop).flatMap(chapter => chapter.steps)
    return total <= steps.length && steps.some(step => narrationBody(step) === match[3])
  })
}

export async function requireTutorialText(client: SupabaseClient, userId: string, tutorialText: string): Promise<void> {
  const { data: master, error: masterError } = await client.from('platform_admins')
    .select('user_id').eq('user_id', userId).maybeSingle()
  if (masterError) throw masterError
  const contexts: TutorialAccess[] = [{ role: 'client', modules: [], hasShop: true }]
  if (master) {
    contexts.push({ role: 'master', modules: allModules, hasShop: true },
      { role: 'master', modules: ['ai'], hasShop: false })
  } else {
    const { data: members, error: memberError } = await client.from('memberships')
      .select('barbershop_id,role').eq('user_id', userId).eq('active', true)
    if (memberError) throw memberError
    if ((members || []).some(member => member.role === 'admin')) {
      contexts.push({ role: 'admin', modules: allModules, hasShop: true })
    }
    const barberShops = (members || []).filter(member => member.role === 'barber').map(member => member.barbershop_id)
    if (barberShops.length) {
      const { data: permissions, error: permissionError } = await client.from('module_permissions')
        .select('barbershop_id,module,allowed').eq('user_id', userId).in('barbershop_id', barberShops)
      if (permissionError) throw permissionError
      for (const shopId of barberShops) {
        const modules: ModuleKey[] = ['dashboard', ...(permissions || [])
          .filter(item => item.barbershop_id === shopId && item.allowed && item.module !== 'profit' && item.module !== 'branding'
            && allModules.includes(item.module as ModuleKey)).map(item => item.module as ModuleKey)]
        contexts.push({ role: 'barber', modules, hasShop: true })
      }
    }
  }
  if (!isTutorialTextAllowed(tutorialText, contexts)) {
    throw new HttpError(403, 'Este áudio não pertence aos passos do tutorial disponíveis para seu perfil.')
  }
}
