#!/usr/bin/env node
'use strict';

// NocLauncher Relay Service (MVP foundation)
// Control-plane + UDP forwarder skeleton for future full relay mode.

const http = require('http');
const dgram = require('dgram');
const crypto = require('crypto');

const API_PORT = Number(process.env.RELAY_API_PORT || 8790);
const UDP_PORT = Number(process.env.RELAY_UDP_PORT || 19140);
const HOST = process.env.RELAY_HOST || '0.0.0.0';
const SESSION_TTL_MS = Number(process.env.RELAY_SESSION_TTL_MS || 120000);

const sessions = new Map(); // sessionId -> session
const peers = new Map(); // "ip:port" -> { sessionId, role }

function now(){ return Date.now(); }
function id(){ return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function token(){ return Math.random().toString(36).slice(2, 12).toUpperCase(); }

function send(res, status, payload){
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function parseBody(req){
  return new Promise((resolve,reject)=>{
    let data='';
    req.on('data',(c)=>{ data+=c; if(data.length>2_000_000){ reject(new Error('payload_too_large')); req.destroy(); } });
    req.on('end',()=>{ if(!data) return resolve({}); try{ resolve(JSON.parse(data)); } catch { reject(new Error('invalid_json')); } });
    req.on('error', reject);
  });
}

function cleanup(){
  const t = now();
  for(const [sid, s] of sessions.entries()){
    if(t - s.lastSeen > SESSION_TTL_MS){
      sessions.delete(sid);
    }
  }
}
setInterval(cleanup, 10000).unref();

const udp = dgram.createSocket('udp4');
udp.on('message', (msg, rinfo) => {
  const key = `${rinfo.address}:${rinfo.port}`;
  const p = peers.get(key);
  if (!p) return; // unknown endpoint
  const s = sessions.get(p.sessionId);
  if (!s) return;
  s.lastSeen = now();

  const dst = p.role === 'host' ? s.playerEndpoint : s.hostEndpoint;
  if (!dst) return;
  udp.send(msg, dst.port, dst.address);
});
udp.on('error', ()=>{});
udp.bind(UDP_PORT, HOST);

const api = http.createServer(async (req,res)=>{
  if(req.method === 'OPTIONS') return send(res,204,{});
  try{
    const u = new URL(String(req.url || '/'), `http://${HOST}:${API_PORT}`);
    const path = u.pathname;

    if(req.method==='GET' && path==='/health'){
      return send(res,200,{ok:true, service:'noc-relay-service', sessions:sessions.size, udpPort:UDP_PORT});
    }

    if(req.method==='POST' && path==='/session/create'){
      const b = await parseBody(req);
      const roomId = String(b.roomId || '').trim();
      if(!roomId) return send(res,400,{ok:false,error:'roomId_required'});
      const sessionId = id();
      const hostToken = token();
      const playerToken = token();
      sessions.set(sessionId, { sessionId, roomId, hostToken, playerToken, hostEndpoint:null, playerEndpoint:null, createdAt:now(), lastSeen:now() });
      return send(res,200,{ok:true, sessionId, relay:{host: b.publicRelayHost || null, udpPort:UDP_PORT}, hostToken, playerToken});
    }

    if(req.method==='POST' && path==='/session/bind'){
      const b = await parseBody(req);
      const sessionId = String(b.sessionId || '').trim();
      const role = String(b.role || '').trim(); // host|player
      const address = String(b.address || '').trim();
      const port = Number(b.port || 0);
      if(!sessionId || !role || !address || !port) return send(res,400,{ok:false,error:'session_bind_fields_required'});
      const s = sessions.get(sessionId);
      if(!s) return send(res,404,{ok:false,error:'session_not_found'});

      const ep = { address, port };
      if(role==='host') s.hostEndpoint = ep;
      else if(role==='player') s.playerEndpoint = ep;
      else return send(res,400,{ok:false,error:'invalid_role'});

      peers.set(`${address}:${port}`, { sessionId, role });
      s.lastSeen = now();
      return send(res,200,{ok:true, ready: !!(s.hostEndpoint && s.playerEndpoint)});
    }

    if(req.method==='GET' && path==='/session/status'){
      const sid = String(u.searchParams.get('sessionId') || '').trim();
      if(!sid) return send(res,400,{ok:false,error:'sessionId_required'});
      const s = sessions.get(sid);
      if(!s) return send(res,404,{ok:false,error:'session_not_found'});
      return send(res,200,{ok:true, session:{
        sessionId:s.sessionId,
        roomId:s.roomId,
        ready: !!(s.hostEndpoint && s.playerEndpoint),
        lastSeen:s.lastSeen,
        createdAt:s.createdAt
      }});
    }

    return send(res,404,{ok:false,error:'not_found'});
  }catch(e){
    return send(res,400,{ok:false,error:String(e.message||e)});
  }
});

api.listen(API_PORT, HOST, ()=>{
  console.log(`[relay] api=http://${HOST}:${API_PORT} udp=${UDP_PORT}`);
});
