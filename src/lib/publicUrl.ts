export const publicSystemOrigin='https://sistemadebarbearia.com.br'
export function publicShopUrl(slug:string,path=''):string {
 return `${publicSystemOrigin}/b/${encodeURIComponent(slug)}${path}`
}
