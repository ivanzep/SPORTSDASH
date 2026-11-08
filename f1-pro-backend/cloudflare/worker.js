// Cloudflare Durable Object SignalR Core client; upstream is unofficial and may change.
const SEP='\x1e';
const TOPICS=['Heartbeat','SessionInfo','SessionData','SessionStatus','TimingData','TimingAppData','DriverList','RaceControlMessages','TrackStatus','WeatherData','LapCount'];
const FEED='https://livetiming.formula1.com/signalrcore';
function merge(old,patch){
 if(!patch||typeof patch!=='object'||Array.isArray(patch))return patch;
 const result={...((old&&!Array.isArray(old)&&typeof old==='object')?old:{})};
 for(const [key,val] of Object.entries(patch)){if(val===null)delete result[key];else result[key]=merge(result[key],val)}
 return result;
}
export class F1State{
 constructor(state,env){this.state=state;this.env=env;this.socket=null;this.buffer='';this.connected=false;this.error=null;this.lastUpdate=null;this.feeds={};this.starting=false;this.sessionStarted=false;this.lastPing=0}
 async health(){return {connected:this.connected,lastUpdate:this.lastUpdate,error:this.error,upstream:FEED,receiver:'SignalR Core',status:this.connected?'connected':'disconnected',dataReceived:Object.keys(this.feeds).length>0}}
 async snapshot(){
 const lines=this.feeds.TimingData?.Lines||{},drivers=this.feeds.DriverList||{},stints=this.feeds.TimingAppData?.Lines||{};
 const entries=Object.entries(lines).map(([number,line])=>{const driver=drivers[number]||{},ss=stints[number]?.Stints||[];const stint=Array.isArray(ss)?ss.at(-1):null;return {number:Number(number),name:driver.Tla||driver.LastName||number,team:driver.TeamName||'',position:Number(line.Position||99),gap:line.GapToLeader||'—',interval:line.IntervalToPositionAhead?.Value||'—',lap:line.NumberOfLaps||'—',lapTime:line.LastLapTime?.Value||'—',tyre:stint?.Compound||'—',stint:stint?.TotalLaps||'—'}}).sort((a,b)=>a.position-b.position);
 const messages=this.feeds.RaceControlMessages?.Messages||[];
 return {live:this.connected,entries,control:Array.isArray(messages)?messages.slice(-8).reverse():[],session:this.feeds.SessionInfo||null,updatedAt:this.lastUpdate,errors:this.error?[this.error]:[]};
 }
 async start(){
  if(this.connected||this.starting)return this.health();
  this.starting=true;
  try{
   // ASP.NET Core SignalR negotiates a connectionToken, not the legacy SignalR 2 token.
   const token=this.env.F1_TV_ACCESS_TOKEN;
   const headers=token?{Authorization:'Bearer '+token}:{};
   const response=await fetch(FEED+'/negotiate?negotiateVersion=1',{method:'POST',headers});
   if(!response.ok)throw Error('SignalR negotiate HTTP '+response.status);
   const negotiation=await response.json();
   if(negotiation.error)throw Error(String(negotiation.error));
   const connectionToken=negotiation.connectionToken||negotiation.connectionId;
   if(!connectionToken)throw Error('No SignalR connection token');
   const wsUrl=new URL(FEED.replace(/^http/,'ws'));wsUrl.searchParams.set('id',connectionToken);
   // Bearer auth is not embedded in browser URLs. Workers supports custom headers on fetch.
   const wsResponse=await fetch(wsUrl.toString(),{headers:{...headers,Upgrade:'websocket'}});
   if(wsResponse.status!==101||!wsResponse.webSocket)throw Error('WebSocket upgrade HTTP '+wsResponse.status);
   const socket=wsResponse.webSocket;this.socket=socket;
   socket.accept();
   socket.addEventListener('message',event=>this.consume(String(event.data)));
   socket.addEventListener('close',()=>{this.connected=false;this.socket=null;this.scheduleReconnect()});
   socket.addEventListener('error',()=>{this.connected=false;this.error='WebSocket error';this.scheduleReconnect()});
   socket.send(JSON.stringify({protocol:'json',version:1})+SEP);
   this.connected=true;this.error=null;
   await this.state.storage.setAlarm(Date.now()+60_000);
  }catch(err){this.connected=false;this.error=String(err?.message||err);await this.scheduleReconnect()}
  finally{this.starting=false}
  return this.health();
 }
 async scheduleReconnect(){await this.state.storage.setAlarm(Date.now()+30_000)}
 consume(data){
  this.buffer+=data;
  const frames=this.buffer.split(SEP);this.buffer=frames.pop()||'';
  for(const frame of frames){if(!frame)continue;let msg;try{msg=JSON.parse(frame)}catch{continue}
   if(msg.type===6){this.socket?.send(JSON.stringify({type:6})+SEP);continue}
   if(msg.type===7){this.connected=false;this.error=msg.error||'Server closed connection';continue}
   if(msg.type===1&&msg.target?.toLowerCase()==='feed'){
    const args=msg.arguments||[];
    // F1 feed commonly arrives as ["Topic", payload, timestamp].
    if(typeof args[0]==='string')this.ingest(args[0],args[1]);
   }
   if(msg.type===1&&msg.target?.toLowerCase()==='feed'&&Array.isArray(msg.arguments?.[0])){
    for(const item of msg.arguments[0])if(item?.M)this.ingest(item.M,item.A);
   }
   if(msg.type===3&&msg.invocationId==='1'&&msg.result&&typeof msg.result==='object'){
    for(const [topic,value] of Object.entries(msg.result))this.ingest(topic,value);
   }
   if(!('type'in msg)&&!this.sessionStarted){
    this.sessionStarted=true;
    this.socket?.send(JSON.stringify({type:1,target:'Subscribe',arguments:[TOPICS],invocationId:'1'})+SEP);
   }
  }
 }
 ingest(topic,data){if(!TOPICS.includes(topic))return;this.feeds[topic]=merge(this.feeds[topic],data);this.lastUpdate=new Date().toISOString()}
 async alarm(){if(!this.connected)await this.start();else await this.state.storage.setAlarm(Date.now()+60_000)}
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  const origin=request.headers.get('Origin');
  const allow=origin==='https://ivanzep.github.io';
  const headers={'content-type':'application/json','cache-control':'no-store','vary':'Origin',...(allow?{'access-control-allow-origin':origin}:{})};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'GET,POST','access-control-allow-headers':'Content-Type,Authorization'}});
  const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
  if(url.pathname==='/api/f1/health')return reply({service:'sportsdash-f1',status:'deployed',publicAccess:false});
  // Private API requires a secret; never place this token in public GitHub Pages.
  const expected=env.DASHBOARD_API_KEY;
  if(!expected||request.headers.get('Authorization')!=='Bearer '+expected)return reply({error:'Private backend; configure server-side authorization'},401);
  const stub=env.F1_STATE.getByName('live-timing');
  if(url.pathname==='/api/f1/start'&&request.method==='POST')return reply(await stub.start());
  if(url.pathname==='/api/f1/health/private')return reply(await stub.health());
  if(url.pathname==='/api/f1/snapshot')return reply(await stub.snapshot());
  return reply({error:'Not found'},404);
 }
};
