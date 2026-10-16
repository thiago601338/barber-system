// New Supabase API keys are not JWTs. Preserve real user JWTs while avoiding
// sending the server API key in the bearer slot to Auth/Storage.
export function serverSupabaseFetch(apiKey:string,baseUrl:string):typeof fetch {
  return (input,init)=>{
    const url=input instanceof Request?input.url:String(input)
    const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined))
    if(apiKey.startsWith('sb_secret_')&&new URL(url).origin===new URL(baseUrl).origin&&headers.get('authorization')===`Bearer ${apiKey}`)headers.delete('authorization')
    return fetch(input,{...init,headers})
  }
}
