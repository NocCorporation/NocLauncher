#!/usr/bin/env node
'use strict';

const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 60000);
const MAX_ROOMS_PER_HOST = Number(process.env.MAX_ROOMS_PER_HOST || 3);

/** @type {Map<string, any>} */
const rooms = new Map();

function now() { return Date.now(); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function send(res, status, payload) {
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

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error('payload_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function sanitizeRoom(input) {
  const hostId = String(input?.hostId || '').trim();
  if (!hostId) throw new Error('hostId_required');

  const worldName = String(input?.worldName || 'Bedrock world').trim().slice(0, 80);
  const hostName = String(input?.hostName || 'Host').trim().slice(0, 40);
  const gameVersion = String(input?.gameVersion || '').trim().slice(0, 24);
  const mode = String(input?.mode || 'survival').trim().slice(0, 24);

  const connectType = String(input?.connect?.type || 'direct').trim();
  const ip = String(input?.connect?.ip || '').trim().slice(0, 128);
  const port = Number(input?.connect?.port || 19132);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error('invalid_port');

  const isPrivate = !!input?.isPrivate;
  const joinCode = input?.joinCode ? String(input.joinCode).trim().slice(0, 64) : null;
  const maxPlayers = Math.max(1, Math.min(100, Number(input?.maxPlayers || 10)));

  return {
    hostId,
    hostName,
    worldName,
    gameVersion,
    mode,
    connect: { type: connectType, ip, port },
    isPrivate,
    joinCode,
    maxPlayers
  };
}

function activeRoomList() {
  const t = now();
  return [...rooms.values()]
    .filter((r) => t - r.lastHeartbeatAt <= ROOM_TTL_MS)
    .map((r) => ({
      roomId: r.roomId,
      hostId: r.hostId,
      hostName: r.hostName,
      worldName: r.worldName,
      gameVersion: r.gameVersion,
      mode: r.mode,
      connect: r.connect,
      isPrivate: r.isPrivate,
      maxPlayers: r.maxPlayers,
      createdAt: r.createdAt,
      lastHeartbeatAt: r.lastHeartbeatAt
    }));
}

function cleanupExpired() {
  const t = now();
  for (const [id, room] of rooms.entries()) {
    if (t - room.lastHeartbeatAt > ROOM_TTL_MS) rooms.delete(id);
  }
}
setInterval(cleanupExpired, 10_000).unref();

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    const path = (req.url || '').split('?')[0];

    if (req.method === 'GET' && path === '/health') {
      return send(res, 200, { ok: true, service: 'noc-local-servers-registry', rooms: activeRoomList().length, ttlMs: ROOM_TTL_MS });
    }

    if (req.method === 'GET' && path === '/world/list') {
      return send(res, 200, { ok: true, servers: activeRoomList() });
    }

    if (req.method === 'POST' && path === '/world/open') {
      const body = await parseBody(req);
      const roomData = sanitizeRoom(body);

      const hostRooms = [...rooms.values()].filter((r) => r.hostId === roomData.hostId);
      if (hostRooms.length >= MAX_ROOMS_PER_HOST) {
        return send(res, 429, { ok: false, error: 'rooms_limit_reached' });
      }

      const roomId = uid();
      const item = { ...roomData, roomId, createdAt: now(), lastHeartbeatAt: now() };
      rooms.set(roomId, item);
      return send(res, 200, { ok: true, roomId });
    }

    if (req.method === 'POST' && path === '/world/heartbeat') {
      const body = await parseBody(req);
      const hostId = String(body?.hostId || '').trim();
      const roomId = String(body?.roomId || '').trim();
      if (!hostId) return send(res, 400, { ok: false, error: 'hostId_required' });

      let updated = 0;
      if (roomId && rooms.has(roomId)) {
        const room = rooms.get(roomId);
        if (room.hostId === hostId) {
          room.lastHeartbeatAt = now();
          updated = 1;
        }
      } else {
        for (const room of rooms.values()) {
          if (room.hostId === hostId) {
            room.lastHeartbeatAt = now();
            updated++;
          }
        }
      }
      return send(res, 200, { ok: true, updated });
    }

    if (req.method === 'POST' && path === '/world/close') {
      const body = await parseBody(req);
      const hostId = String(body?.hostId || '').trim();
      const roomId = String(body?.roomId || '').trim();
      if (!hostId) return send(res, 400, { ok: false, error: 'hostId_required' });

      let removed = 0;
      if (roomId && rooms.has(roomId)) {
        const room = rooms.get(roomId);
        if (room.hostId === hostId) {
          rooms.delete(roomId);
          removed = 1;
        }
      } else {
        for (const [id, room] of rooms.entries()) {
          if (room.hostId === hostId) {
            rooms.delete(id);
            removed++;
          }
        }
      }
      return send(res, 200, { ok: true, removed });
    }

    if (req.method === 'POST' && path === '/world/join-by-code') {
      const body = await parseBody(req);
      const joinCode = String(body?.joinCode || '').trim();
      if (!joinCode) return send(res, 400, { ok: false, error: 'joinCode_required' });

      const room = [...rooms.values()].find((r) => r.joinCode === joinCode);
      if (!room) return send(res, 404, { ok: false, error: 'not_found' });

      return send(res, 200, {
        ok: true,
        room: {
          roomId: room.roomId,
          hostName: room.hostName,
          worldName: room.worldName,
          gameVersion: room.gameVersion,
          mode: room.mode,
          connect: room.connect,
          isPrivate: room.isPrivate
        }
      });
    }

    return send(res, 404, { ok: false, error: 'not_found' });
  } catch (e) {
    return send(res, 400, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[noc-registry] listening on http://${HOST}:${PORT}`);
});
