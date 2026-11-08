import express from 'express';
import cors from 'cors';
import * as signalR from '@microsoft/signalr';

const PORT=Number(process.env.PORT||8787);
const ORIGIN=process.env.FRONTEND_ORIGIN||'';
const API_KEY=process.env.DASHBOARD_API_KEY||'';
const SIGNALR_URL=process.env.F1_SIGNALR_URL||'https://livetiming.formula1.com/signalrcore';
const TOPICS=['Heartbeat','SessionInfo','SessionData','SessionStatus','TimingData','TimingAppData','DriverList','RaceControlMessages','TrackStatus','WeatherData','LapCount','CarData.z','Position.z'];
const app=express();
app.disable('x-powered-by');
app.use(cors({origin:(origin,cb)=>cb(null,!origin||Boolean(ORIGIN&&origin===ORIGIN)),allowedHeaders:['Content-Type','X-Dashboard-Key']}));
app.use('/api', (req,res,next)=>{
  if(API_KEY && req.get('X-Dashboard-Key')!==API_KEY)return res.status(401).json({error:'Unauthorized'});
  next();
});
const state={connected:false,lastUpdate:null,error:null,feeds:{},session:null};
const clone=v=>JSON.parse(JSON.stringify(v));
function merge(previous,delta){
 if(Array.isArray(delta))return delta;
 if(!delta||typeof delta!=='object')return delta;
 if(!previous||typeof previous!=='object'||Array.isArray(previous))previous={};
 for(const [key,value] of Object.entries(delta)){
  if(value===null){delete previous[key];continue}
  previous[key]=value&&typeof value==='object'&&!Array.isArray(value)?merge(previous[key],value):value;
 }
 return previous;
}
function ingest(message){
 if(!message||typeof message!=='object')return;
 const topic=message.M||message.Topic||message.topic;
 const payload=message.A??message.Data??message.data;
 if(typeof topic!=='string')return;
 // The .z channels are base64+zlib payloads; preserve them for an authorized private consumer.
 state.feeds[topic]=merge(state.feeds[topic],payload);
 state.lastUpdate=new Date().toISOString();
 if(topic==='SessionInfo')state.session=state.feeds[topic];
}
const valueOf=(obj,...keys)=>keys.reduce((v,k)=>v?.[k],obj);
function entries(){
 const lines=state.feeds.TimingData?.Lines||{};
 const drivers=state.feeds.DriverList||{};
 const stints=state.feeds.TimingAppData?.Lines||{};
 return Object.entries(lines).map(([number,line])=>{
  const d=drivers[number]||{},s=stints[number]||{};
  const latestStint=Array.isArray(s.Stints)?s.Stints.at(-1):null;
  return {number:Number(number),name:d.Tla||d.LastName||number,team:d.TeamName||'',
   position:Number(line.Position||99),gap:line.GapToLeader??'—',interval:valueOf(line,'IntervalToPositionAhead','Value')??'—',
   lap:line.NumberOfLaps??'—',lapTime:valueOf(line,'LastLapTime','Value')??'—',
   tyre:latestStint?.Compound||'—',stint:latestStint?.TotalLaps??'—'};
 }).sort((a,b)=>a.position-b.position);
}
app.get('/api/f1/health',(req,res)=>res.json({connected:state.connected,lastUpdate:state.lastUpdate,error:state.error,session:state.session?.Name||null}));
app.get('/api/f1/snapshot',(req,res)=>{
 const session=state.session||{};
 const requested=req.query.session_key;
 const actual=session.Key||session.SessionKey;
 if(requested&&actual&&String(requested)!==String(actual))return res.status(409).json({error:'Different active session',activeSession:actual});
 const control=state.feeds.RaceControlMessages?.Messages||[];
 res.set('Cache-Control','no-store').json({session:{session_key:actual,session_name:session.Name||session.Type||'F1 live'},live:state.connected,entries:entries(),control:Array.isArray(control)?control.slice(-8).reverse():[],errors:state.error?[state.error]:[],updatedAt:state.lastUpdate});
});
app.get('/api/f1/raw',(req,res)=>res.status(404).json({error:'Raw timing streams are not publicly exposed'}));
const server=app.listen(PORT,()=>console.log('F1 backend listening on '+PORT));
const connection=new signalR.HubConnectionBuilder().withUrl(SIGNALR_URL,{
 transport:signalR.HttpTransportType.WebSockets|signalR.HttpTransportType.LongPolling,
 accessTokenFactory:()=>process.env.F1_TV_ACCESS_TOKEN||'',
 headers:{'User-Agent':'SPORTSDASH private timing client'}
}).withAutomaticReconnect([0,2000,5000,10000,30000]).configureLogging(signalR.LogLevel.Warning).build();
connection.on('feed',ingest);
connection.on('Feed',ingest);
connection.onreconnecting(err=>{state.connected=false;state.error=err?.message||'Reconnecting'});
connection.onreconnected(async()=>{state.connected=true;state.error=null;try{await connection.invoke('Subscribe',TOPICS)}catch(err){state.error=err.message}});
connection.onclose(err=>{state.connected=false;state.error=err?.message||'Disconnected'});
async function connect(){
 try{
  await connection.start();state.connected=true;state.error=null;
  const initial=await connection.invoke('Subscribe',TOPICS);
  if(initial&&typeof initial==='object')for(const [topic,payload] of Object.entries(initial))ingest({M:topic,A:payload});
  console.log('F1 SignalR subscribed');
 }catch(err){
  state.connected=false;state.error=err.message;
  console.error('SignalR connection failed:',err.message);
  setTimeout(connect,15000).unref();
 }
}
connect();
process.on('SIGTERM',async()=>{await connection.stop();server.close()});
