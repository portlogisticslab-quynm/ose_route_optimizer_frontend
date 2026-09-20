// Development defaults to same-origin /api and Vite proxies it to FastAPI.
// This avoids localhost/127.0.0.1 CORS mismatches. Set VITE_API_URL only when
// the API is intentionally hosted on a different origin.
const API=(import.meta.env.VITE_API_URL || '').replace(/\/$/,'')
export function token(){return sessionStorage.getItem('ose_token')||''}
export async function api<T>(path:string,init:RequestInit={}):Promise<T>{
 const headers=new Headers(init.headers||{})
 if(!(init.body instanceof FormData))headers.set('Content-Type','application/json')
 if(token())headers.set('Authorization',`Bearer ${token()}`)
 try{
  const r=await fetch(API+path,{...init,headers})
  if(!r.ok){let msg=await r.text();try{msg=JSON.parse(msg).detail||msg}catch{};throw new Error(msg||`HTTP ${r.status}`)}
  return r.json()
 }catch(err:any){
  if(err instanceof TypeError)throw new Error('Cannot connect to FastAPI backend. Confirm the backend PowerShell is running and http://localhost:8000/api/health opens successfully.')
  throw err
 }
}
export {API}
