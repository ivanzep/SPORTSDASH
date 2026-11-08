// SPORTSDASH F1 timing relay. No F1 credentials or user session data are persisted.
// The F1 SignalR Core API is unofficial and may change without notice.
const SEP='\x1e';
const FEED='https://livetiming.formula1.com/signalrcore';
const SITE='https://ivanzep.github.io';
const TOPICS=['Heartbeat','SessionInfo','SessionData','SessionStatus','TimingData','TimingAppData','DriverList','RaceControlMessages','TrackStatus','WeatherData','LapCount'];
function merge(old,patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))return patch;
  const out={...((old&&typeof old==='object'&&!Array.isArray(old))?old:{})};
  for(const [k,v] of Object.entries(patch)){if(v===null)delete out[k];else out[k]=merge(out[k],v)}
  return out;
}
export class F1State {
  constructor(state,env){
    this.state=state;this.env=env;this.socket=null;this.buffer='';this.phase='idle';this.error=null;
    this.feeds={};this.lastUpdate=null;this.lastSeen=0;this.starting=false;this.subscribed=false;
  }
  health(){
    return {connected:this.phase==='connected'||this.phase==='subscribed'||this.phase==='receiving',
      phase:this.phase,error:this.error,lastUpdate:this.lastUpdate,dataReceived:Object.keys(this.feeds).length>0,
      credentialsPersisted:false};
  }
  heartbeat(){this.lastSeen=Date.now();return this.health()}
  snapshot(){
    this.lastSeen=Date.now();
    const lines=this.feeds.TimingData?.Lines||{};
    const drivers=this.feeds.DriverList||{};
    const stints=this.feeds.TimingAppData?.Lines||{};
    const entries=Object.entries(lines).map(([number,line])=>{
      const driver=drivers[number]||{};
      const allStints=stints[number]?.Stints||{};
      const finalStint=Array.isArray(allStints)?allStints.at(-1):Object.values(allStints).at(-1);
      return {number:Number(number),name:driver.Tla||driver.LastName||number,team:driver.TeamName||'',
        position:Number(line.Position||99),gap:line.GapToLeader||'—',
        interval:line.IntervalToPositionAhead?.Value||'—',lap:line.NumberOfLaps||'—',
        lapTime:line.LastLapTime?.Value||'—',tyre:finalStint?.Compound||'—',
        stint:finalStint?.TotalLaps||'—'};
    }).sort((a,b)=>a.position-b.position);
    const messages=this.feeds.RaceControlMessages?.Messages||[];
    return {live:this.phase==='receiving'&&!!this.lastUpdate&&Date.now()-Date.parse(this.lastUpdate)<120000,
      entries,control:(Array.isArray(messages)?messages:Object.values(messages)).slice(-10).reverse(),
      session:this.feeds.SessionInfo||null,updatedAt:this.lastUpdate,
      errors:this.error?[this.error]:[],phase:this.phase};
  }
  async start(token){
    this.lastSeen=Date.now();
    if(this.starting||this.socket)return this.health();
    if(typeof token!=='string'||token.length<48||token.length>8192||/\s/.test(token))
      return {connected:false,phase:'error',error:'A valid F1 account bearer token is required'};
    this.starting=true;this.phase='negotiating';this.error=null;this.subscribed=false;
    try {
      // F1 currently uses an AWS ALB sticky cookie for its negotiate/upgrade pair.
      const headers={Authorization:'Bearer '+token};
      try{
        const pre=await fetch(FEED+'/negotiate?negotiateVersion=1',{method:'OPTIONS',headers});
        const m=(pre.headers.get('set-cookie')||'').match(/(?:^|,\s*)AWSALBCORS=([^;]+)/i);
        if(m)headers.Cookie='AWSALBCORS='+m[1];
      }catch{ /* Some upstream POPs do not require the sticky cookie. */ }
      const response=await fetch(FEED+'/negotiate?negotiateVersion=1',{method:'POST',headers});
      if(!response.ok)throw Error('F1 negotiate failed: HTTP '+response.status);
      const negotiation=await response.json();
      if(negotiation.error)throw Error('F1 negotiate rejected the session');
      const connectionToken=negotiation.connectionToken||negotiation.connectionId;
      if(!connectionToken)throw Error('F1 negotiate did not return a connection ID');
      const wsUrl=new URL(FEED.replace(/^http/,'ws'));
      wsUrl.searchParams.set('id',connectionToken);
      wsUrl.searchParams.set('access_token',token); // F1 upstream only; never a SPORTSDASH URL.
      const upgrade=await fetch(wsUrl.toString(),{headers:{...headers,Upgrade:'websocket'}});
      if(upgrade.status!==101||!upgrade.webSocket)throw Error('F1 WebSocket rejected: HTTP '+upgrade.status);
      const socket=upgrade.webSocket;this.socket=socket;
      socket.accept();
      socket.addEventListener('message',ev=>this.consume(typeof ev.data==='string'?ev.data:''));
      socket.addEventListener('close',()=>{if(this.socket===socket){this.socket=null;this.phase='disconnected';this.error='Upstream WebSocket closed';}});
      socket.addEventListener('error',()=>{if(this.socket===socket){this.socket=null;this.phase='disconnected';this.error='Upstream WebSocket error';}});
      this.phase='connected';socket.send(JSON.stringify({protocol:'json',version:1})+SEP);
      await this.state.storage.setAlarm(Date.now()+30000);
    }catch(err){
      // Never return request URLs or headers: upstream URLs can contain the access token.
      const message=String(err?.message||'F1 connection failed');
      this.error=/^F1 (?:negotiate|WebSocket)/.test(message)?message:'F1 connection failed; check token and feed availability';
      this.phase='disconnected';this.socket=null;
    }finally{this.starting=false}
    return this.health();
  }
  consume(data){
    this.buffer+=data;
    const frames=this.buffer.split(SEP);this.buffer=frames.pop()||'';
    for(const frame of frames){
      if(!frame)continue;
      let m;try{m=JSON.parse(frame)}catch{continue}
      if(!('type' in m)){
        if(m.error){this.error='F1 SignalR handshake rejected';this.stop();continue}
        if(!this.subscribed){
          this.subscribed=true;this.phase='subscribed';
          this.socket?.send(JSON.stringify({type:1,invocationId:'1',target:'Subscribe',arguments:[TOPICS]})+SEP);
        }
      } else if(m.type===1&&String(m.target).toLowerCase()==='feed'){
        const a=m.arguments||[];
        if(typeof a[0]==='string')this.ingest(a[0],a[1]);
        else if(Array.isArray(a[0]))for(const item of a[0])if(Array.isArray(item)&&typeof item[0]==='string')this.ingest(item[0],item[1]);
      } else if(m.type===3&&m.invocationId==='1'&&m.result&&typeof m.result==='object'){
        for(const [topic,value] of Object.entries(m.result))this.ingest(topic,value);
      } else if(m.type===7){this.error='F1 SignalR closed the session';this.stop();}
    }
  }
  ingest(topic,data){
    if(!TOPICS.includes(topic))return;
    this.feeds[topic]=merge(this.feeds[topic],data);
    this.lastUpdate=new Date().toISOString();this.phase='receiving';
  }
  stop(){
    const ws=this.socket;this.socket=null;
    try{ws?.close(1000,'Browser session ended')}catch{}
    this.feeds={};this.buffer='';this.lastUpdate=null;this.phase='disconnected';this.subscribed=false;
    this.error=null;this.lastSeen=0;
    this.state.storage.deleteAlarm();
    return {disconnected:true};
  }
  async alarm(){
    if(!this.socket)return;
    if(Date.now()-this.lastSeen>90000){this.stop();return}
    try{this.socket.send(JSON.stringify({type:6})+SEP)}catch{this.stop();return}
    await this.state.storage.setAlarm(Date.now()+30000);
  }
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin');
    const headers={'content-type':'application/json','cache-control':'no-store','vary':'Origin',
      ...(origin===SITE?{'access-control-allow-origin':SITE}:{})};
    const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
    if(origin&&origin!==SITE)return reply({error:'Origin not allowed'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
      ...headers,'access-control-allow-methods':'GET,POST,OPTIONS',
      'access-control-allow-headers':'Content-Type,X-Session-Key',
      'access-control-max-age':'600'}});
    const path=new URL(request.url).pathname;
    if(path==='/api/f1/health'&&request.method==='GET')
      return reply({service:'sportsdash-f1',status:'ready',authentication:'browser-session',credentialsPersisted:false});
    const key=request.headers.get('X-Session-Key')||'';
    if(!/^[a-f0-9]{64}$/.test(key))return reply({error:'Invalid or missing session'},401);
    // Random 256-bit capability isolates users: no globally shared timing state.
    const stub=env.F1_STATE.getByName('session:'+key);
    if(path==='/api/f1/start'&&request.method==='POST'){
      let body;try{body=await request.json()}catch{return reply({error:'Invalid JSON'},400)}
      return reply(await stub.start(body?.accessToken));
    }
    if(path==='/api/f1/heartbeat'&&request.method==='GET')return reply(await stub.heartbeat());
    if(path==='/api/f1/snapshot'&&request.method==='GET')return reply(await stub.snapshot());
    if(path==='/api/f1/disconnect'&&request.method==='POST')return reply(await stub.stop());
    return reply({error:'Not found'},404);
  }
};
