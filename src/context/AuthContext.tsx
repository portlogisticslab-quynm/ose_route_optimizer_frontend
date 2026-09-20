import React,{createContext,useContext,useEffect,useState} from 'react';import {api} from '../api';import type {User} from '../types'
const C=createContext<any>(null)
export function AuthProvider({children}:{children:React.ReactNode}){const [user,setUser]=useState<User|null>(null);const [loading,setLoading]=useState(true)
 useEffect(()=>{if(!sessionStorage.getItem('ose_token')){setLoading(false);return}api<User>('/api/auth/me').then(setUser).catch(()=>sessionStorage.removeItem('ose_token')).finally(()=>setLoading(false))},[])
 async function login(id:string,password:string){const r=await api<any>('/api/auth/login',{method:'POST',body:JSON.stringify({user_id:id,password})});sessionStorage.setItem('ose_token',r.access_token);setUser(r.user)}
 function logout(){sessionStorage.removeItem('ose_token');setUser(null)}
 return <C.Provider value={{user,loading,login,logout,setUser}}>{children}</C.Provider>}
export const useAuth=()=>useContext(C)
