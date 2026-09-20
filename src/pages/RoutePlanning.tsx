import {useEffect,useMemo,useState} from 'react'
import {api} from '../api'
import type {Location,Equipment,RouteResult} from '../types'
import RouteMap from '../components/RouteMap'
import {useAuth} from '../context/AuthContext'

type FormState={
 origin:string;destination:string;weight:number|string;volume:number|string;value:number|string;containers:number|string;
 cargo:string;equipment:string;airFactor:number|string;storageDays:number|string;insurance:number|string;
 maxDays:number|string;maxLegs:number|string;maxCost:number|string;minReliability:number|string;objective:string;topN:number|string;
 completeOnly:boolean;groupNodePaths:boolean;allowedModes:Record<string,boolean>
}

type RateDraft={
 link_id:string;code:string;name:string;carrier:string;equipment_id:string;rate:number|string;currency:string;basis:string;
 fuel_pct:number|string;surcharge:number|string;surcharge_basis:string;valid_from:string;valid_to:string;active:boolean
}

const BASES=['SHIPMENT','KG','TON','M3','REVENUE_TON','KM','TON_KM','CONTAINER','TEU','FEU','PALLET','DAY','HOUR']
const DEFAULT_FORM:FormState={
 origin:'',destination:'',weight:1000,volume:2,value:10000,containers:1,cargo:'general',equipment:'ANY',
 airFactor:167,storageDays:1,insurance:0.5,maxDays:45,maxLegs:6,maxCost:'',minReliability:0,
 objective:'cost',topN:5,completeOnly:false,groupNodePaths:true,
 allowedModes:{road:true,rail:true,sea:true,air:true,inland:true}
}

export default function RoutePlanning(){
 const {user}=useAuth()
 const [locations,setLocations]=useState<Location[]>([])
 const [equipment,setEquipment]=useState<Equipment[]>([])
 const [routes,setRoutes]=useState<RouteResult[]>([])
 const [selected,setSelected]=useState(0)
 const [status,setStatus]=useState('Loading master data...')
 const [error,setError]=useState(false)
 const [f,setF]=useState<FormState>(DEFAULT_FORM)
 const [rateDraft,setRateDraft]=useState<RateDraft|null>(null)
 const [rateLeg,setRateLeg]=useState<any>(null)
 const [rateMsg,setRateMsg]=useState('')

 useEffect(()=>{
  Promise.all([api<Location[]>('/api/master/locations'),api<Equipment[]>('/api/master/equipment')])
   .then(([l,e])=>{
    setLocations(l);setEquipment(e)
    setF(x=>{
      const hasOrigin=l.some(z=>z.id===x.origin),hasDest=l.some(z=>z.id===x.destination)
      return {...x,origin:hasOrigin?x.origin:(l[0]?.id||''),destination:hasDest?x.destination:(l[1]?.id||'')}
    })
    setStatus(`Backend connected · ${l.length} locations · ${e.length} equipment records loaded.`);setError(false)
   })
   .catch((e:any)=>{setStatus(e?.message||'Unable to load backend master data.');setError(true)})
 },[])

 function setMode(mode:string,checked:boolean){setF({...f,allowedModes:{...f.allowedModes,[mode]:checked}})}

 async function search(){
  if(!f.origin||!f.destination||f.origin===f.destination){setStatus('Select two different locations.');setError(true);return}
  const allowedModes=Object.entries(f.allowedModes).filter(([,v])=>v).map(([k])=>k)
  if(!allowedModes.length){setStatus('Select at least one allowed transport mode.');setError(true);return}
  setStatus('Searching server-side transport network...');setError(false)
  try{
   const r=await api<any>('/api/routes/search',{method:'POST',body:JSON.stringify({
    origin_id:f.origin,destination_id:f.destination,
    shipment:{weight_kg:+f.weight,volume_m3:+f.volume,cargo_value_usd:+f.value,containers:+f.containers,cargo_type:f.cargo,equipment_id:f.equipment,air_factor:+f.airFactor,storage_days:+f.storageDays,insurance_pct:+f.insurance},
    constraints:{max_days:+f.maxDays,max_legs:+f.maxLegs,max_cost:f.maxCost===''?null:+f.maxCost,min_reliability:+f.minReliability,allowed_modes:allowedModes,complete_only:f.completeOnly,group_node_paths:f.groupNodePaths,strict_rate_validity:true},
    objective:f.objective,top_n:+f.topN
   })})
   setRoutes(r.routes||[]);setSelected(0)
   if((r.routes||[]).length){const scope=r.network_scope==='MASTER_PLUS_OWN_PENDING'?'Master + my Pending contributions':'Approved Master';setStatus(`Explored ${r.explored} states · ${r.paths_found} structural paths · ${r.routes.length} route(s) returned · Network: ${scope}.`);setError(false)}
   else{const scope=r.network_scope==='MASTER_PLUS_OWN_PENDING'?'Master + my Pending contributions':'Approved Master';setStatus(`No feasible route found. Explored ${r.explored} states · ${r.paths_found} structural paths · Network: ${scope}. Check direction, modes, time/leg constraints and current Rate Cards.`);setError(true)}
  }catch(e:any){setRoutes([]);setSelected(0);setStatus(e?.message||'Route Search failed.');setError(true)}
 }

 function openCreateRate(l:any){
  if(user.role==='viewer')return
  const from=locations.find(x=>x.id===l.from_id)?.code||l.from_id
  const to=locations.find(x=>x.id===l.to_id)?.code||l.to_id
  const eq=(f.equipment&&f.equipment!=='ANY'?f.equipment:(l.available_equipment?.[0]||'ANY')).toUpperCase()
  const stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,14)
  setRateLeg(l);setRateMsg('')
  setRateDraft({
   link_id:l.link_id,
   code:`RT-${String(l.mode||'GEN').toUpperCase()}-${from}-${to}-${eq}-${stamp}`,
   name:`${from} → ${to} · ${l.carrier||'New Rate'} · ${eq}`,
   carrier:l.carrier||'',equipment_id:eq,rate:0,currency:'USD',basis:'SHIPMENT',fuel_pct:0,surcharge:0,surcharge_basis:'SHIPMENT',
   valid_from:new Date().toISOString().slice(0,10),valid_to:'',active:true
  })
 }

 async function saveRate(){
  if(!rateDraft)return
  if(!rateDraft.code.trim()||!rateDraft.name.trim()){setRateMsg('Rate Code and Rate Name are required.');return}
  if(+rateDraft.rate<=0){setRateMsg('Enter a Freight Rate greater than 0.');return}
  try{
   const body={...rateDraft,rate:+rateDraft.rate,fuel_pct:+rateDraft.fuel_pct,surcharge:+rateDraft.surcharge,valid_to:rateDraft.valid_to||null,valid_from:rateDraft.valid_from||null}
   const saved=await api<any>('/api/master/rates',{method:'POST',body:JSON.stringify(body)})
   setRateDraft(null);setRateLeg(null)
   if(saved.approval_status==='PENDING'){
    setStatus(`Rate Card ${saved.code} saved as STUDENT-PENDING. It is immediately available in your own Route Search, but remains invisible to other students until approval.`);setError(false)
    await search()
   }else{
    setStatus(`Rate Card ${saved.code} created. Recalculating current route...`);setError(false)
    await search()
   }
  }catch(e:any){setRateMsg(e?.message||'Unable to create Rate Card.')}
 }

 const r=routes[selected]
 const serviceGroups=useMemo(()=>{
  const out:Record<string,any[]>={}
  for(const x of (r?.services?.items||[])){(out[x.node_id] ||= []).push(x)}
  return out
 },[r])

 return <>
  <div className="page-head"><div><h2>Global Route Planning</h2><p>Origin A → Destination B · Road / Rail / Sea / Air / Inland Waterway</p></div><span className="pill">V1.1.1 · SERVER DATABASE + OWN PENDING</span></div>
  <div className="planner-grid">
   <section className="card form-card">
    <h3>Shipment & Constraints</h3>
    <label>Điểm xuất phát A</label><select value={f.origin} onChange={e=>setF({...f,origin:e.target.value})}>{locations.map(x=><option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select>
    <label>Điểm đến B</label><select value={f.destination} onChange={e=>setF({...f,destination:e.target.value})}>{locations.map(x=><option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select>
    <div className="row"><Field label="Trọng lượng (kg)" value={f.weight} onChange={v=>setF({...f,weight:v})}/><Field label="Khối tích (m³)" value={f.volume} onChange={v=>setF({...f,volume:v})}/></div>
    <div className="row"><Field label="Giá trị hàng (USD)" value={f.value} onChange={v=>setF({...f,value:v})}/><Field label="Số container" value={f.containers} onChange={v=>setF({...f,containers:v})}/></div>
    <div className="row3"><Field label="Air volume factor (kg/m³)" value={f.airFactor} onChange={v=>setF({...f,airFactor:v})}/><Field label="Default storage (days)" value={f.storageDays} onChange={v=>setF({...f,storageDays:v})}/><Field label="Insurance (% cargo value)" value={f.insurance} onChange={v=>setF({...f,insurance:v})}/></div>
    <div className="row"><div><label>Loại hàng</label><select value={f.cargo} onChange={e=>setF({...f,cargo:e.target.value})}><option value="general">General cargo</option><option value="container">Containerized</option><option value="reefer">Reefer / Perishable</option><option value="hazmat">Dangerous goods</option><option value="oversized">Oversized</option><option value="valuable">High value</option></select></div><div><label>Equipment / Load Unit</label><select value={f.equipment} onChange={e=>setF({...f,equipment:e.target.value})}>{equipment.map(x=><option key={x.id} value={x.id}>{x.id} — {x.name}</option>)}</select></div></div>
    <div className="row"><Field label="Thời gian tối đa (ngày)" value={f.maxDays} onChange={v=>setF({...f,maxDays:v})}/><Field label="Số chặng tối đa" value={f.maxLegs} onChange={v=>setF({...f,maxLegs:v})}/></div>
    <div className="row"><div><label>Chi phí tối đa (USD, optional)</label><input placeholder="No limit" value={f.maxCost} onChange={e=>setF({...f,maxCost:e.target.value})}/></div><Field label="Reliability tối thiểu (%)" value={f.minReliability} onChange={v=>setF({...f,minReliability:v})}/></div>
    <div className="constraint-box"><b>Allowed transport modes</b><div className="mode-checks">
     {([['road','Road'],['rail','Rail'],['sea','Sea'],['air','Air'],['inland','Inland Waterway']] as const).map(([m,label])=><label className="check-inline" key={m}><input type="checkbox" checked={!!f.allowedModes[m]} onChange={e=>setMode(m,e.target.checked)}/>{label}</label>)}
    </div>
    <label className="check-line"><input type="checkbox" checked={f.completeOnly} onChange={e=>setF({...f,completeOnly:e.target.checked})}/> Only fully costed routes (no missing freight rate)</label>
    <label className="check-line"><input type="checkbox" checked={f.groupNodePaths} onChange={e=>setF({...f,groupNodePaths:e.target.checked})}/> Group same node sequence (best network/carrier variant only)</label>
    </div>
    <div className="row"><div><label>Mục tiêu tối ưu</label><select value={f.objective} onChange={e=>setF({...f,objective:e.target.value})}><option value="cost">Lowest total logistics cost</option><option value="time">Fastest</option><option value="distance">Shortest distance</option><option value="transfers">Fewest transfers</option><option value="reliability">Highest reliability</option><option value="co2">Lowest CO₂</option><option value="balanced">Balanced multi-criteria</option></select></div><div><label>Số tuyến trả về</label><select value={f.topN} onChange={e=>setF({...f,topN:e.target.value})}><option value="3">Top 3</option><option value="5">Top 5</option></select></div></div>
    <button className="primary full" onClick={search}>Search Top Routes</button>
    <div className={'status '+(error?'status-error':'')}>{status}</div>
   </section>
   <section className="card"><h3>Route Map</h3><RouteMap path={r?.path||[]} locations={locations}/></section>
  </div>

  {r&&<div className="kpis"><K label="Total logistics cost" value={`$${r.total.toLocaleString(undefined,{maximumFractionDigits:2})}`}/><K label="Transit time" value={`${(r.hours/24).toFixed(1)} d`}/><K label="Distance" value={`${r.distance_km.toFixed(0)} km`}/><K label="Transfers" value={`${r.transfers}`}/><K label="Reliability" value={`${r.reliability.toFixed(1)}%`}/><K label="CO₂ prototype" value={`${r.co2_kg.toFixed(0)} kg`}/></div>}

  <div className="split"><section className="card"><div className="card-title-line"><h3>Candidate Routes</h3><span className="pill">{routes.length} routes</span></div>{routes.length?routes.map((x:any,i)=><div className={'route-card '+(i===selected?'selected':'')} key={i} onClick={()=>setSelected(i)}><div className="route-title-line"><b>#{i+1} {x.path.map((id:string)=>locations.find(l=>l.id===id)?.code||id).join(' → ')}</b>{x.uses_pending_student_data&&<span className="pending-route-badge">USES MY PENDING DATA</span>}</div>{(x.network_variant_count||1)>1&&<small className="block">{x.network_variant_count} network/carrier variants share this node path; best variant shown.</small>}{x.uses_pending_student_data&&<small className="pending-route-note">This calculation includes your own unapproved contribution(s): {(x.pending_student_records||[]).map((z:any)=>z.code||z.id).join(', ')}. These records are not shared with other students until approved.</small>}<div className="route-mini"><span>${x.total.toFixed(2)}</span><span>{(x.hours/24).toFixed(1)} d</span><span>{x.distance_km.toFixed(0)} km</span><span>{x.transfers} transfers</span><span>{x.reliability.toFixed(1)}%</span><span>{x.co2_kg.toFixed(0)} kg CO₂</span></div></div>):<div className="empty">Run Route Search to view candidates.</div>}</section>
   <section className="card"><h3>Route Cost & Service Breakdown</h3>{r?<>
    {r.uses_pending_student_data&&<div className="pending-data-warning"><b>Student working route:</b> this calculation uses your own Pending contribution(s). Cost and connectivity are valid for your personal workspace only until Instructor/Admin approval.</div>}
    <div className="cost-grid"><K label="Main Transport" value={`$${r.transport.toFixed(2)}`}/><K label="Logistics + Services" value={`$${r.services.total.toFixed(2)}`}/><K label="Insurance" value={`$${r.insurance.toFixed(2)}`}/><K label="Total" value={`$${r.total.toFixed(2)}`}/></div>
    <div className="completeness">Cost completeness <b>{r.completeness}%</b></div>
    <h4>Legs & Freight Audit</h4>
    {r.legs.map((l:any,i)=><div className="leg" key={i}><div><b>{i+1}. {l.from_id} → {l.to_id} · {l.mode} {(l.link_approval_status==='PENDING'||l.rate_approval_status==='PENDING')&&<span className="inline-pending">PENDING</span>}</b><small>{l.link_code} · {l.rate_code||'MISSING CURRENT RATE'} · {l.carrier||''}</small>{l.missing_rate&&<small className="missing-hint">Reason: {missingReason(l)}{l.available_equipment?.length?` · Available equipment: ${l.available_equipment.join(', ')}`:''}</small>}</div><div className="right">{l.missing_rate?<><span className="bad">MISSING RATE</span>{user.role!=='viewer'&&<button className="small-btn success-lite create-rate-btn" onClick={()=>openCreateRate(l)}>+ Create Rate Card</button>}</>:<><b>${l.total.toFixed(2)}</b><small>Qty {Number(l.qty||0).toFixed(2)} · Freight ${Number(l.freight||0).toFixed(2)} · Fuel ${Number(l.fuel||0).toFixed(2)} · Surcharge ${Number(l.surcharge||0).toFixed(2)}</small></>}</div></div>)}

    <div className="node-services-head"><div><h4>Node Services</h4><small>Required services, recommended services and optional cost items generated for each route node.</small></div><div className="service-summary">Service completeness <b>{r.services?.pct??100}%</b> · Required complete <b>{r.services?.complete??0}/{r.services?.required??0}</b></div></div>
    {Object.keys(serviceGroups).length?Object.entries(serviceGroups).map(([nodeId,items])=>{
      const loc=locations.find(x=>x.id===nodeId);const nodeTotal=items.reduce((a:number,x:any)=>a+Number(x.cost||0),0);const context=items[0]?.context||''
      return <div className="node-service-card" key={nodeId}><div className="node-service-title"><div><b>{loc?.code||items[0]?.node_code||nodeId} — {loc?.name||items[0]?.node_name||nodeId}</b><small>{context} · {loc?.type||items[0]?.node_type||''}</small></div><b>${nodeTotal.toFixed(2)}</b></div><div className="service-table-head"><span>Service</span><span>Requirement</span><span>Qty</span><span>Rate / Basis</span><span>Total</span></div>{items.map((s:any)=><div className={'node-service-row '+(!s.enabled?'disabled':'')} key={`${nodeId}-${s.service_id}`}><div><b>{s.name}</b>{s.reason&&<small>{s.reason}</small>}</div><span><span className={'source '+s.requirement}>{s.requirement}</span></span><span>{Number(s.qty||0).toFixed(2)}</span><span>{Number(s.rate||0).toFixed(2)} {s.currency||'USD'} / {s.basis}</span><b>${Number(s.cost||0).toFixed(2)}</b></div>)}</div>
    }):<div className="empty compact-empty">No Node Services matched this route and shipment context.</div>}
   </>:<div className="empty">Run search and select a route.</div>}</section>
  </div>

  {rateDraft&&<div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget){setRateDraft(null);setRateLeg(null)}}}><div className="modal-card"><div className="modal-head"><div><h3>Create Rate Card for Missing Freight</h3><small>{rateLeg?.link_code} · {rateLeg?.from_id} → {rateLeg?.to_id} · {rateLeg?.mode}</small></div><button className="x" onClick={()=>{setRateDraft(null);setRateLeg(null)}}>×</button></div><div className="modal-body">
   <div className="note-box">This Rate Card is linked directly to the missing transport leg. Admin/Instructor records become active Master Data immediately; Student records are saved as Pending Review until approved.</div>
   <div className="form-grid two"><RF label="Rate Code *"><input value={rateDraft.code} onChange={e=>setRateDraft({...rateDraft,code:e.target.value})}/></RF><RF label="Rate Name *"><input value={rateDraft.name} onChange={e=>setRateDraft({...rateDraft,name:e.target.value})}/></RF></div>
   <div className="form-grid three"><RF label="Carrier"><input value={rateDraft.carrier} onChange={e=>setRateDraft({...rateDraft,carrier:e.target.value})}/></RF><RF label="Equipment"><select value={rateDraft.equipment_id} onChange={e=>setRateDraft({...rateDraft,equipment_id:e.target.value})}>{equipment.map(x=><option key={x.id} value={x.id}>{x.id} — {x.name}</option>)}</select></RF><RF label="Currency"><input value={rateDraft.currency} onChange={e=>setRateDraft({...rateDraft,currency:e.target.value.toUpperCase()})}/></RF></div>
   <div className="form-grid three"><RF label="Freight Rate *"><input type="number" step="any" value={rateDraft.rate} onChange={e=>setRateDraft({...rateDraft,rate:e.target.value})}/></RF><RF label="Basis"><select value={rateDraft.basis} onChange={e=>setRateDraft({...rateDraft,basis:e.target.value})}>{BASES.map(x=><option key={x}>{x}</option>)}</select></RF><RF label="Fuel surcharge (%)"><input type="number" step="any" value={rateDraft.fuel_pct} onChange={e=>setRateDraft({...rateDraft,fuel_pct:e.target.value})}/></RF></div>
   <div className="form-grid three"><RF label="Fixed surcharge"><input type="number" step="any" value={rateDraft.surcharge} onChange={e=>setRateDraft({...rateDraft,surcharge:e.target.value})}/></RF><RF label="Surcharge basis"><select value={rateDraft.surcharge_basis} onChange={e=>setRateDraft({...rateDraft,surcharge_basis:e.target.value})}>{BASES.map(x=><option key={x}>{x}</option>)}</select></RF><RF label="Status"><select value={String(rateDraft.active)} onChange={e=>setRateDraft({...rateDraft,active:e.target.value==='true'})}><option value="true">active</option><option value="false">inactive</option></select></RF></div>
   <div className="form-grid two"><RF label="Valid From"><input type="date" value={rateDraft.valid_from} onChange={e=>setRateDraft({...rateDraft,valid_from:e.target.value})}/></RF><RF label="Valid To"><input type="date" value={rateDraft.valid_to} onChange={e=>setRateDraft({...rateDraft,valid_to:e.target.value})}/></RF></div>
   {rateMsg&&<div className="status status-error">{rateMsg}</div>}
   <div className="modal-actions"><button onClick={()=>{setRateDraft(null);setRateLeg(null)}}>Cancel</button><button className="primary" onClick={saveRate}>Create Rate Card</button></div>
  </div></div></div>}
 </>
}

function missingReason(l:any){if(l.missing_reason==='NO_RATE_CARDS')return 'No Rate Card exists for this Transport Link';if(l.missing_reason==='NO_COMPATIBLE_EQUIPMENT')return 'No Rate Card matches the selected Equipment';if(l.missing_reason==='NO_CURRENT_RATE')return 'Compatible Rate Card exists but none is currently valid';return 'No compatible current Rate Card could be costed'}
function Field({label,value,onChange}:{label:string,value:number|string,onChange:(v:string)=>void}){return <div><label>{label}</label><input type="number" value={value} onChange={e=>onChange(e.target.value)}/></div>}
function K({label,value}:{label:string,value:string}){return <div className="kpi"><small>{label}</small><b>{value}</b></div>}
const RF=({label,children}:{label:string;children:any})=><label className="field"><span>{label}</span>{children}</label>
