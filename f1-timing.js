/* SPORTSDASH OpenF1 integration: historical public data; live requires an access token.
   Never store passwords or tokens in source control or localStorage. */
const OpenF1Timing=(()=>{
const BASE='https://api.openf1.org/v1/';
let accessToken='';
const setToken=value=>{accessToken=String(value||'').trim()};
const hasToken=()=>Boolean(accessToken);
async function get(path,params={}){
 const url=new URL(BASE+path);
 Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')url.searchParams.set(k,String(v))});
 const headers=accessToken?{Authorization:'Bearer '+accessToken}:{};
 const response=await fetch(url,{headers});
 if(!response.ok)throw Error('OpenF1 '+response.status+(response.status===401||response.status===403?' — live timing needs an authorized token':''));
 return response.json();
}
function newestByDriver(rows){
 const map=new Map();
 for(const item of rows||[]){const key=item.driver_number;if(key==null)continue;
 const previous=map.get(key);
 if(!previous||String(item.date||'')>=String(previous.date||''))map.set(key,item);
 }
 return map;
}
async function sessions(year){return get('sessions',{year,session_type:'Race'})}
async function snapshot(session){
 const key=session.session_key;
 const live=new Date(session.date_start).getTime()<=Date.now()&&new Date(session.date_end).getTime()+900000>=Date.now();
 const after=live?new Date(Date.now()-180000).toISOString():undefined;
 const req=(endpoint,params={})=>get(endpoint,{session_key:key,...params}).catch(error=>({error:error.message}));
 const [drivers,positions,intervals,laps,stints,control,classification]=await Promise.all([
 req('drivers'),req('position',after?{'date>':after}:{}),req('intervals',after?{'date>':after}:{}),
 req('laps'),req('stints'),req('race_control',after?{'date>':after}:{}),req('session_result')
 ]);
 const d=Array.isArray(drivers)?drivers:[],p=newestByDriver(Array.isArray(positions)?positions:[]),
 gaps=newestByDriver(Array.isArray(intervals)?intervals:[]),lap=newestByDriver(Array.isArray(laps)?laps:[]);
 const tyre=new Map();for(const t of Array.isArray(stints)?stints:[]){const old=tyre.get(t.driver_number);if(!old||Number(t.stint_number)>Number(old.stint_number))tyre.set(t.driver_number,t)}
 const classified=new Map((Array.isArray(classification)?classification:[]).map(x=>[x.driver_number,x]));
 const driversByNumber=new Map(d.map(x=>[x.driver_number,x]));
 const numbers=new Set([...p.keys(),...classified.keys(),...driversByNumber.keys()]);
 const entries=[...numbers].map(n=>{const dr=driversByNumber.get(n)||{},pos=p.get(n)||{},gap=gaps.get(n)||{},l=lap.get(n)||{},t=tyre.get(n)||{},c=classified.get(n)||{};return {number:n,name:dr.name_acronym||dr.last_name||String(n),team:dr.team_name||'',position:pos.position??c.position??99,gap:gap.gap_to_leader??'—',interval:gap.interval??'—',lap:l.lap_number??'—',lapTime:l.lap_duration??'—',tyre:t.compound||'—',stint:t.stint_number||'—'}});
 entries.sort((a,b)=>Number(a.position)-Number(b.position));
 const errors=[drivers,positions,intervals,laps,stints,control,classification].filter(x=>x&&x.error).map(x=>x.error);
 return {session,live,entries,control:Array.isArray(control)?control.slice(-8).reverse():[],errors};
}
return {setToken,hasToken,sessions,snapshot};
})();
