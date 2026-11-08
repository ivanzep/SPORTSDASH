/* Browser-session-only F1 timing adapter.
   The F1 access token and 256-bit session capability are held exclusively in JS memory.
   Never put either into localStorage, sessionStorage, URL parameters, or logs.
   Cloudflare receives the bearer token only in the HTTPS POST body used to start the
   SignalR upstream connection; it must never save it to Worker secrets or DO storage. */
const F1ProClient=(()=>{
  const DEFAULT_ENDPOINT='https://sportsdash-f1.zepivan.workers.dev';
  let endpoint=DEFAULT_ENDPOINT,accessToken='',sessionKey='',lastAttempt=0;
  const configured=()=>Boolean(endpoint);
  const active=()=>Boolean(accessToken&&sessionKey);
  const urlFor=path=>new URL(endpoint+path);
  const key=()=>{
    const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
    return [...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
  };
  function configure(url){
    if(active())throw Error('Disconnect F1 timing before changing the backend');
    const value=url||DEFAULT_ENDPOINT;
    const parsed=new URL(value);
    if(parsed.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(parsed.hostname)))
      throw Error('HTTPS is required');
    if(parsed.username||parsed.password||parsed.search||parsed.hash)
      throw Error('Backend URL cannot contain credentials, query strings, or fragments');
    endpoint=parsed.origin+parsed.pathname.replace(/\/$/,'');
  }
  async function request(path,method='GET',body,capability=sessionKey){
    if(!endpoint)throw Error('Configure an F1 backend first');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const res=await fetch(urlFor(path),{
        method,headers:{'X-Session-Key':capability,...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,cache:'no-store'
      });
      const result=await res.json().catch(()=>({}));
      if(!res.ok)throw Error(result.error||'F1 backend HTTP '+res.status);
      return result;
    }finally{clearTimeout(timer)}
  }
  async function connect(token){
    const bearer=String(token||'').trim();
    if(bearer.length<48||bearer.length>8192||/\s/.test(bearer))
      throw Error('Enter a valid F1 account bearer token (not your password)');
    if(!sessionKey)sessionKey=key();
    lastAttempt=Date.now();
    try{
      const result=await request('/api/f1/start','POST',{accessToken:bearer});
      if(result.error)throw Error(result.error);
      accessToken=bearer;return result;
    }catch(err){accessToken='';sessionKey='';throw err}
  }
  async function maintain(){
    if(!active())return {phase:'idle'};
    const health=await request('/api/f1/heartbeat');
    if((health.phase==='disconnected'||health.phase==='idle')&&Date.now()-lastAttempt>=30000){
      lastAttempt=Date.now();
      const result=await request('/api/f1/start','POST',{accessToken});
      if(result.error)throw Error(result.error);
      return result;
    }
    return health;
  }
  async function snapshot(){
    if(!active())throw Error('Connect F1 timing first');
    const result=await request('/api/f1/snapshot');
    if(!result||!Array.isArray(result.entries))throw Error('Unexpected backend snapshot');
    return result;
  }
  async function disconnect(){
    const cap=sessionKey;
    accessToken='';sessionKey='';lastAttempt=0;
    if(cap)try{await request('/api/f1/disconnect','POST',null,cap)}catch{ /* Remote session expires without keepalive. */ }
    return {disconnected:true};
  }
  return {configure,configured,active,connect,maintain,snapshot,disconnect,endpoint:()=>endpoint};
})();
