import {publicWhatsappPhone,publicWhatsappUrl} from './publicContact'

/** Dados cadastrais públicos da empresa responsável pelo Barber System (Receita Federal, CNPJ 58.541.121/0001-20). */
export const company = {
  brand: 'Barber System',
  legalName: 'Barbearia Kingsmann Ltda',
  tradeName: 'Barbear Kingsmam',
  cnpj: '58.541.121/0001-20',
  cnpjDigits: '58541121000120',
  legalNature: 'Sociedade Empresária Limitada',
  size: 'Microempresa (ME), optante pelo Simples Nacional',
  mainActivity: 'CNAE 96.02-5-01 · Cabeleireiros, manicure e pedicure',
  openedAt: '23/12/2024',
  status: 'Ativa',
  street: 'Avenida Engenheiro Mário de Gusmão, 738',
  district: 'Ponta Verde',
  city: 'Maceió',
  state: 'AL',
  zip: '57035-000',
  country: 'BR',
  email: 'contato@sistemadebarbearia.com.br',
  phone: publicWhatsappPhone,
  phoneE164: '+55 82 99644-3151',
  site: 'https://sistemadebarbearia.com.br',
  forum: 'Maceió/AL',
  policiesUpdatedAt: '9 de outubro de 2026'
} as const

export const companyAddressLine = `${company.street} · ${company.district} · ${company.city}/${company.state} · CEP ${company.zip}`

export const legalLinks: {path:string;label:string}[] = [
  {path:'/sobre',label:'Sobre nós'},
  {path:'/contato',label:'Contato'},
  {path:'/politica-de-privacidade',label:'Política de Privacidade'},
  {path:'/termos-de-uso',label:'Termos de Uso'},
  {path:'/politica-de-cancelamento-e-reembolso',label:'Cancelamento e reembolso'},
  {path:'/politica-de-cookies',label:'Política de Cookies'}
]

export function organizationSchema() {
  return {
    '@type': 'Organization',
    '@id': `${company.site}/#organizacao`,
    name: company.brand,
    legalName: company.legalName,
    taxID: company.cnpj,
    url: company.site,
    logo: `${company.site}/brand/barber-system-logo.png`,
    email: company.email,
    telephone: company.phoneE164,
    address: {'@type':'PostalAddress',streetAddress:company.street,addressLocality:company.city,addressRegion:company.state,postalCode:company.zip,addressCountry:company.country},
    contactPoint: [{'@type':'ContactPoint',contactType:'customer support',telephone:company.phoneE164,email:company.email,availableLanguage:['pt-BR']}]
  }
}

const waPath = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z'
export const whatsappSvg = (css = '') => `<svg class="icon icon-whatsapp ${css}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${waPath}"/></svg>`

const esc = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))

/** Único ponto de contato por WhatsApp nas páginas públicas. */
export function whatsappFloat(topic = 'o Barber System') {
  return `<a class="whatsapp-float" data-whatsapp-contact href="${esc(publicWhatsappUrl(topic))}" target="_blank" rel="noopener noreferrer" aria-label="Falar com o Barber System no WhatsApp">${whatsappSvg()}<span>Fale com a gente</span></a>`
}

/** Bloco de identificação da empresa usado no rodapé de todas as páginas públicas. */
export function companyFooterBlock() {
  return `<div class="company-info"><p><strong>${esc(company.brand)}</strong> é um serviço de <strong>${esc(company.legalName)}</strong> · CNPJ ${esc(company.cnpj)}</p><address>${esc(companyAddressLine)}</address><p><a href="mailto:${esc(company.email)}">${esc(company.email)}</a> · <a data-whatsapp-contact href="${esc(publicWhatsappUrl('o Barber System'))}" target="_blank" rel="noopener noreferrer">WhatsApp ${esc(company.phone)}</a></p></div><nav class="legal-links" aria-label="Informações legais">${legalLinks.map(l=>`<a href="${l.path}">${esc(l.label)}</a>`).join('')}</nav>`
}
