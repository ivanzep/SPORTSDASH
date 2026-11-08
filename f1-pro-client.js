/* Optional private F1 TV Pro backend adapter for SPORTSDASH.
   The endpoint must be a user-controlled HTTPS service returning normalized JSON.
   No F1 TV credentials or session tokens belong in browser code. */
const F1ProClient=(()=>{
 let endpoint='';
 function configure(url){
   if(!url){endpoint='';return}
   const parsed=new URL(url);
   if(parsed.protocol!=='https:' && !(parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1'))throw Error('HTTPS required for remote F1 backend');
   endpoint=parsed.href.replace(/\/$/,'');
 }
 function configured(){return Boolean(endpoint)}
 async function snapshot(sessionKey){
   if(!endpoint)throw Error('F1 Pro backend not configured');
   const url=new URL(endpoint+'/api/f1/snapshot');
   if(sessionKey)url.searchParams.set('session_key',String(sessionKey));
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
   try{
     const res=await fetch(url,{signal:controller.signal,cache:'no-store'});
     if(!res.ok)throw Error('F1 backend HTTP '+res.status);
     const data=await res.json();
     if(!data||!Array.isArray(data.entries))throw Error('Invalid F1 backend snapshot');
     return data;
   }finally{clearTimeout(timer)}
 }
 return {configure,configured,snapshot};
})();
