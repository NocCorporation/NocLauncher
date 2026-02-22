(() => {
  const $ = (s) => document.querySelector(s);
  let hostWanted = false;
  let visibility = 'public';
  let transport = 'auto';
  let streamerMode = false;
  let collapsed = false;
  let miniMenuOpen = false;

  function paintCollapsed() {
    document.body.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('menu-open', collapsed && miniMenuOpen);
    const c = $('#btnCollapse');
    if (c) c.textContent = collapsed ? 'Показать' : 'Скрыть';
  }

  async function setMiniMenuOpen(next) {
    miniMenuOpen = !!next;
    paintCollapsed();
    try { await window.noc?.bedrockHubQuickMenuSetOpen?.(miniMenuOpen); } catch (_) {}
  }

  function paintMiniFpsState(f) {
    const b = $('#btnMiniFps');
    const st = null;
    const on = !!f?.enabled;
    if (b) {
      b.textContent = on ? 'ВКЛ' : 'ВЫКЛ';
      b.classList.toggle('acc', on);
    }
    const err = String(f?.error || '');
    if (err && on) {
      setInviteStatus(`FPS монитор: ${err}`);
    }
  }

  async function refreshMiniFpsState() {
    try {
      const f = await window.noc?.bedrockFpsGet?.();
      paintMiniFpsState(f || {});
    } catch (_) {}
  }

  async function setCollapsed(next) {
    collapsed = !!next;
    if (!collapsed) {
      miniMenuOpen = false;
      try { await window.noc?.bedrockHubQuickMenuSetOpen?.(false); } catch (_) {}
    }
    try { localStorage.setItem('noc.bedrockHub.collapsed', collapsed ? '1' : '0'); } catch (_) {}
    paintCollapsed();
    try { await window.noc.bedrockHubSetCollapsed(collapsed); } catch (_) {}
  }

  function setHostStatus(t) { const el = $('#hostStatus'); if (el) el.textContent = t; }
  function setInviteStatus(t) { const el = $('#inviteStatus'); if (el) el.textContent = t || ''; }
  function setDiagStatus(t) { const el = $('#diagStatus'); if (el) el.textContent = t || ''; }

  function paintHostToggle() {
    const btn = $('#btnHostToggle');
    if (!btn) return;
    btn.textContent = hostWanted ? 'ХОСТИНГ МИРА: ON' : 'ХОСТИНГ МИРА: OFF';
    btn.classList.add('acc');
  }

  function paintVisibility() {
    const btn = $('#btnVisibility');
    if (!btn) return;
    btn.textContent = `Приватность: ${visibility}`;
  }

  function paintStreamerMode() {
    const btn = $('#btnStreamer');
    if (!btn) return;
    btn.textContent = `Стример-режим: ${streamerMode ? 'ON' : 'OFF'}`;
    btn.classList.toggle('acc', streamerMode);
    const inp = $('#inviteCode');
    if (inp) inp.type = streamerMode ? 'password' : 'text';
  }

  function paintTransport() {
    const btn = $('#btnTransport');
    if (!btn) return;
    btn.textContent = `Транспорт: ${transport}`;
  }

  async function refreshDiagnostics() {
    const [p, c] = await Promise.all([
      window.noc.bedrockPathInfo().catch(() => null),
      window.noc.bedrockConnectivity().catch(() => null)
    ]);
    const src = p?.source || 'unknown';
    const worlds = Number(p?.worldsCount || 0);
    const path = String(p?.comMojang || '').replace(/\\/g, '/');
    const reg = c?.registryOk ? 'ok' : 'fail';
    if (streamerMode) {
      setDiagStatus(`Streamer mode ON • worlds=${worlds} • registry=${reg}`);
    } else {
      setDiagStatus(`Path[${src}] worlds=${worlds} • registry=${reg} • ${path}`);
    }
  }

  async function refresh() {
    const root = $('#servers');
    if (!root) return;

    const r = await window.noc.localServersList();
    if (!r?.ok) {
      root.innerHTML = `<div class="meta">Реестр недоступен (${r?.error || 'unknown'}). Проверь, что registry-сервер запущен.</div>`;
      return;
    }

    const list = Array.isArray(r.servers) ? r.servers : [];
    if (!list.length) {
      root.innerHTML = '<div class="meta">Активных миров пока нет.</div>';
      return;
    }

    root.innerHTML = list.map((s, i) => {
      const name = String(s.worldName || `Мой мир #${i + 1}`);
      const host = String(s.hostName || 'unknown');
      const ip = String(s.connect?.ip || '');
      const port = Number(s.connect?.port || 19132);
      const ver = String(s.gameVersion || 'bedrock');
      const mode = String(s.mode || 'survival');
      const maxPlayers = Number(s.maxPlayers || 10);
      const currentPlayers = Number(s.currentPlayers || 0);
      const disabled = !ip;
      const ava = host ? host.slice(0,1).toUpperCase() : 'H';
      return `<div class="item">
        <div class="ava">${ava}</div>
        <div>
          <div class="name">${name}</div>
          <div class="host">ХОСТ: ${host}</div>
        </div>
        <div>
          <div class="count">${currentPlayers}/${maxPlayers}</div>
          <div class="meta">${mode} • ${ver}</div>
        </div>
        <button class="join" data-ip="${ip}" data-port="${port}" ${disabled ? 'disabled' : ''}>ВСТУПИТЬ</button>
      </div>`;
    }).join('');

    root.querySelectorAll('button[data-ip]').forEach((b) => {
      b.addEventListener('click', async () => {
        const ip = b.getAttribute('data-ip') || '';
        const port = Number(b.getAttribute('data-port') || 19132);
        if (!ip) return;
        await window.noc.shellOpenExternal(`minecraft://?addExternalServer=${encodeURIComponent('Noc Global')}|${ip}:${port}`);
      });
    });
  }

  async function checkBedrockStatus() {
    const s = await window.noc.bedrockHostStatus();
    if (!s?.ok) return;

    // Show HOST ON automatically when world is detected/published.
    hostWanted = !!(s.manualHostWanted || s.autoHosting);
    paintHostToggle();

    if (!s.registryUrl) {
      setHostStatus('Не найден реестр. Подними локальный/внешний registry и он подцепится автоматически.');
      return;
    }

    if (!s.bedrockRunning) {
      setHostStatus(streamerMode ? 'Bedrock не запущен. Нажми «Открыть мир».' : `Реестр подключен. Bedrock не запущен. Нажми «Открыть мир».`);
    } else if (!s.worldOpen && !hostWanted) {
      setHostStatus(streamerMode ? 'Открой мир для сети или включи хост.' : `Реестр подключен. Открой мир для сети или включи хост.`);
    } else if (s.autoHosting) {
      setHostStatus(`Мир «${s.worldName || 'Bedrock'}» опубликован ✅ Игроки: ${s.currentPlayers || 0}/${s.maxPlayers || 10}`);
    } else {
      setHostStatus(`Публикую мир в реестре...`);
    }
  }

  async function init() {
    const vg = await window.noc.localServersVisibilityGet().catch(() => ({ ok:false }));
    visibility = vg?.ok ? String(vg.visibility || 'public') : 'public';
    paintVisibility();

    const tg = await window.noc.localServersTransportGet().catch(() => ({ ok:false }));
    transport = tg?.ok ? String(tg.transport || 'auto') : 'auto';
    paintTransport();

    try {
      const st = await window.noc.settingsGet();
      streamerMode = !!st?.streamerMode;
    } catch (_) { streamerMode = false; }
    paintStreamerMode();

    try { collapsed = localStorage.getItem('noc.bedrockHub.collapsed') === '1'; } catch (_) { collapsed = false; }
    await setCollapsed(collapsed);

    $('#btnRefresh')?.addEventListener('click', async () => { await refresh(); await refreshDiagnostics(); });
    $('#btnAddCreatorFriend')?.addEventListener('click', async () => {
      const deep = 'xbox://profile?gamertag=GoshGame5696';
      const web = 'https://account.xbox.com/Profile?gamertag=GoshGame5696';
      try {
        const r = await window.noc.shellOpenExternal(deep);
        if (r?.ok) {
          setInviteStatus('Открываю профиль Xbox в приложении: GoshGame5696');
          return;
        }
      } catch (_) {}
      try {
        await window.noc.shellOpenExternal(web);
        setInviteStatus('Открываю профиль Xbox в браузере: GoshGame5696');
      } catch (_) {
        setInviteStatus('Не удалось открыть профиль Xbox.');
      }
    });
    $('#btnOpenWorld')?.addEventListener('click', async () => {
      await window.noc.bedrockLaunch();
      setTimeout(checkBedrockStatus, 1200);
    });
    $('#btnHostToggle')?.addEventListener('click', async () => {
      hostWanted = !hostWanted;
      await window.noc.localServersHostSetWanted(hostWanted);
      paintHostToggle();
      await checkBedrockStatus();
    });
    $('#btnVisibility')?.addEventListener('click', async () => {
      visibility = visibility === 'public' ? 'code' : 'public';
      await window.noc.localServersVisibilitySet(visibility);
      paintVisibility();
      setInviteStatus(`Приватность: ${visibility}`);
    });

    $('#btnTransport')?.addEventListener('click', async () => {
      transport = transport === 'auto' ? 'relay-preferred' : (transport === 'relay-preferred' ? 'direct-only' : 'auto');
      const r = await window.noc.localServersTransportSet(transport);
      transport = r?.ok ? String(r.transport || transport) : transport;
      paintTransport();
      setInviteStatus(`Транспорт: ${transport}`);
    });
    $('#btnPickBedrockPath')?.addEventListener('click', async () => {
      const r = await window.noc.bedrockPathSet();
      setInviteStatus(r?.ok ? 'Путь Bedrock сохранён.' : `Путь не изменён: ${r?.error || 'cancel'}`);
      await refreshDiagnostics();
    });

    $('#btnStreamer')?.addEventListener('click', async () => {
      streamerMode = !streamerMode;
      try { await window.noc.settingsSet({ streamerMode }); } catch (_) {}
      paintStreamerMode();
      setInviteStatus(streamerMode ? 'Стример-режим включён: чувствительные данные скрыты.' : 'Стример-режим выключен.');
      await refreshDiagnostics();
      await checkBedrockStatus();
    });

    $('#btnShareInvite')?.addEventListener('click', async () => {
      const r = await window.noc.localServersInviteCreate();
      if (!r?.ok) {
        setInviteStatus(`Не удалось создать инвайт: ${r?.error || 'unknown'}`);
        return;
      }
      const code = String(r.code || '');
      const link = `noclauncher://join/${code}`;
      try {
        await navigator.clipboard.writeText(link);
        setInviteStatus(streamerMode ? 'Инвайт создан и скопирован.' : `Ссылка скопирована: ${link}`);
      } catch {
        setInviteStatus(streamerMode ? 'Инвайт создан.' : `Код приглашения: ${code}`);
      }
      const inp = $('#inviteCode');
      if (inp) inp.value = code;
    });

    $('#btnRevokeInvite')?.addEventListener('click', async () => {
      const code = String($('#inviteCode')?.value || '').trim().toUpperCase();
      if (!code) { setInviteStatus('Введи код для отзыва.'); return; }
      const r = await window.noc.localServersInviteRevoke(code);
      setInviteStatus(r?.ok ? 'Инвайт отозван.' : `Не удалось отозвать: ${r?.error || 'unknown'}`);
    });

    $('#btnJoinByCode')?.addEventListener('click', async () => {
      const code = String($('#inviteCode')?.value || '').trim().toUpperCase();
      if (!code) { setInviteStatus('Введи код приглашения.'); return; }
      const r = await window.noc.localServersJoinByCodeOpen(code);
      if (!r?.ok) { setInviteStatus(`Код не найден: ${r?.error || 'unknown'}`); return; }
      setInviteStatus(streamerMode ? 'Подключение открыто в Bedrock.' : `Подключение открыто (${r.route || 'direct'}): ${r.host || ''}:${r.port || ''}`);
    });

    $('#btnCollapse')?.addEventListener('click', () => setCollapsed(!collapsed));
    $('#btnExpand')?.addEventListener('click', () => { setMiniMenuOpen(false); setCollapsed(false); });
    $('#btnMiniSettings')?.addEventListener('click', async () => {
      await setMiniMenuOpen(!miniMenuOpen);
      if (miniMenuOpen) await refreshMiniFpsState();
    });
    $('#btnMiniClose')?.addEventListener('click', () => window.close());
    $('#btnMiniFps')?.addEventListener('click', async () => {
      const f = await window.noc?.bedrockFpsGet?.();
      const on = !!f?.enabled;
      const r = on ? (await window.noc?.bedrockFpsStop?.()) : (await window.noc?.bedrockFpsStart?.());
      await refreshMiniFpsState();
      if (!r?.ok) {
        if (String(r?.error || '') === 'noc_fps_counter_missing') {
          setInviteStatus('FPS монитор: не найден NocFpsCounter.exe в tools/fps-counter.');
        } else {
          setInviteStatus(`FPS монитор: ошибка — ${r?.error || 'unknown'}`);
        }
      } else {
        setInviteStatus(`FPS монитор: ${on ? 'выключен' : 'включён'}`);
      }
    });
    // fallback FPS tools removed: launcher uses built-in NocFpsCounter.exe

    window.addEventListener('keydown', (e) => {
      if (e.key === 'F8') setCollapsed(!collapsed);
      if (e.key === 'Escape' && miniMenuOpen) setMiniMenuOpen(false);
    });
    document.addEventListener('click', (e) => {
      if (!miniMenuOpen) return;
      const t = e.target;
      if (t?.closest?.('#miniMenu') || t?.closest?.('#btnMiniSettings')) return;
      setMiniMenuOpen(false);
    });

    $('#btnCloseWin')?.addEventListener('click', () => window.close());

    window.noc?.onBedrockFps?.((d) => {
      if (miniMenuOpen) paintMiniFpsState(d || {});
    });

    setInterval(async () => {
      await checkBedrockStatus();
      await refresh();
      await refreshDiagnostics();
      if (miniMenuOpen) await refreshMiniFpsState();
    }, 1200);

    await checkBedrockStatus();
    await refresh();
    await refreshDiagnostics();
  }

  init();
})();
