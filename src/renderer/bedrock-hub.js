(() => {
  const $ = (s) => document.querySelector(s);
  let hostWanted = false;
  let visibility = 'public';

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

  async function refreshDiagnostics() {
    const [p, c] = await Promise.all([
      window.noc.bedrockPathInfo().catch(() => null),
      window.noc.bedrockConnectivity().catch(() => null)
    ]);
    const src = p?.source || 'unknown';
    const worlds = Number(p?.worldsCount || 0);
    const path = String(p?.comMojang || '').replace(/\\/g, '/');
    const reg = c?.registryOk ? 'ok' : 'fail';
    const ip = c?.publicIp || 'n/a';
    setDiagStatus(`Path[${src}] worlds=${worlds} • registry=${reg} • ip=${ip} • ${path}`);
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
      setHostStatus(`Реестр: ${s.registryUrl}. Bedrock не запущен. Нажми «Открыть мир».`);
    } else if (!s.worldOpen && !hostWanted) {
      setHostStatus(`Реестр: ${s.registryUrl}. Открой мир для сети или включи хост.`);
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

    $('#btnRefresh')?.addEventListener('click', async () => { await refresh(); await refreshDiagnostics(); });
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
    $('#btnPickBedrockPath')?.addEventListener('click', async () => {
      const r = await window.noc.bedrockPathSet();
      setInviteStatus(r?.ok ? 'Путь Bedrock сохранён.' : `Путь не изменён: ${r?.error || 'cancel'}`);
      await refreshDiagnostics();
    });

    $('#btnShareInvite')?.addEventListener('click', async () => {
      const r = await window.noc.localServersInviteCreate();
      if (!r?.ok) {
        setInviteStatus(`Не удалось создать инвайт: ${r?.error || 'unknown'}`);
        return;
      }
      const code = String(r.code || '');
      const link = `noclauncher://join/${code}`;
      try { await navigator.clipboard.writeText(link); setInviteStatus(`Ссылка скопирована: ${link}`); }
      catch { setInviteStatus(`Код приглашения: ${code}`); }
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
      const r = await window.noc.localServersInviteResolve(code);
      if (!r?.ok || !r.room) { setInviteStatus(`Код не найден: ${r?.error || 'unknown'}`); return; }
      const ip = String(r.room?.connect?.ip || '');
      const port = Number(r.room?.connect?.port || 19132);
      if (!ip) { setInviteStatus('У хоста нет публичного адреса.'); return; }
      await window.noc.shellOpenExternal(`minecraft://?addExternalServer=${encodeURIComponent(r.room.worldName || 'Noc World')}|${ip}:${port}`);
      setTimeout(() => { window.noc.shellOpenExternal('minecraft://').catch(() => {}); }, 700);
      setInviteStatus(`Сервер добавлен и Bedrock открыт: ${ip}:${port}`);
    });

    $('#btnCloseWin')?.addEventListener('click', () => window.close());

    setInterval(async () => {
      await checkBedrockStatus();
      await refresh();
      await refreshDiagnostics();
    }, 1200);

    await checkBedrockStatus();
    await refresh();
    await refreshDiagnostics();
  }

  init();
})();
