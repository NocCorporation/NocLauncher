(() => {
  const $ = (s) => document.querySelector(s);
  let roomId = null;
  let hb = null;

  function setHostStatus(t) { const el = $('#hostStatus'); if (el) el.textContent = t; }

  async function checkBedrockStatus() {
    try {
      const r = await window.noc.bedrockHostStatus();
      if (!r?.ok) return;
      if (!r.bedrockRunning) {
        setHostStatus('Bedrock не запущен. Нажми "Открыть Bedrock".');
      } else if (!r.worldOpen) {
        setHostStatus('Bedrock запущен, но мир не открыт. Зайди в обычный мир, затем включи хост.');
      } else {
        setHostStatus('Мир открыт. Можно хостить ✅');
      }
    } catch (_) {}
  }

  function stopHb() {
    if (hb) { clearInterval(hb); hb = null; }
  }

  function startHb() {
    stopHb();
    hb = setInterval(async () => {
      try { await window.noc.localServersHeartbeat({ roomId }); } catch (_) {}
    }, 15000);
  }

  async function refresh() {
    const root = $('#servers');
    if (!root) return;
    root.innerHTML = '<div class="meta">Загружаю...</div>';
    try {
      const r = await window.noc.localServersList();
      if (!r?.ok) {
        root.innerHTML = `<div class="meta">Ошибка: ${r?.error || 'unknown'}</div>`;
        return;
      }
      const list = Array.isArray(r.servers) ? r.servers : [];
      if (!list.length) {
        root.innerHTML = '<div class="meta">Пока пусто. Открой свой мир первым 🚀</div>';
        return;
      }
      root.innerHTML = list.map((s, i) => {
        const name = String(s.worldName || `Server #${i+1}`);
        const host = String(s.hostName || 'unknown');
        const ip = String(s.connect?.ip || '');
        const port = Number(s.connect?.port || 19132);
        const version = String(s.gameVersion || '—');
        const mode = String(s.mode || 'survival');
        const disabled = !ip;
        return `<div class="item">
          <div>
            <div class="name">${name}<span class="pill">${mode}</span></div>
            <div class="meta">Host: ${host} • ${ip ? `${ip}:${port}` : 'скрыто'} • v${version}</div>
          </div>
          <button class="btn ${disabled ? 'ghost' : 'acc'}" data-ip="${ip}" data-port="${port}" ${disabled ? 'disabled' : ''}>Подключиться</button>
        </div>`;
      }).join('');

      root.querySelectorAll('button[data-ip]').forEach((b) => {
        b.addEventListener('click', async () => {
          const ip = b.getAttribute('data-ip') || '';
          const port = Number(b.getAttribute('data-port') || 19132);
          if (!ip) return;
          const uri = `minecraft://?addExternalServer=${encodeURIComponent('Noc Global')}|${ip}:${port}`;
          await window.noc.shellOpenExternal(uri);
        });
      });
    } catch (e) {
      root.innerHTML = `<div class="meta">Ошибка: ${String(e?.message || e)}</div>`;
    }
  }

  async function saveRegistry() {
    const url = String($('#registryUrl')?.value || '').trim();
    await window.noc.settingsSet({ localServersRegistryUrl: url });
    setHostStatus(url ? 'URL реестра сохранён.' : 'URL очищен.');
  }

  async function openHost() {
    const worldName = String($('#worldName')?.value || 'Мой Bedrock мир').trim();
    const port = Number($('#worldPort')?.value || 19132) || 19132;
    const status = await window.noc.bedrockHostStatus();
    if (!status?.bedrockRunning || !status?.worldOpen) {
      setHostStatus('Сначала зайди в мир Bedrock (обычный мир), потом включай хост.');
      return;
    }

    const res = await window.noc.localServersOpen({
      worldName,
      gameVersion: 'bedrock',
      mode: 'survival',
      connect: { type: 'direct', ip: '', port }
    });

    if (!res?.ok) {
      setHostStatus(`Не удалось открыть хост: ${res?.error || 'unknown'}`);
      return;
    }

    roomId = res.roomId || null;
    startHb();
    setHostStatus('Хост включён. Ты в ленте серверов ✅');
    refresh();
  }

  async function closeHost() {
    const r = await window.noc.localServersClose({ roomId });
    stopHb();
    roomId = null;
    setHostStatus(r?.ok ? 'Хост выключен.' : `Ошибка: ${r?.error || 'unknown'}`);
    refresh();
  }

  async function init() {
    const st = await window.noc.settingsGet();
    if ($('#registryUrl')) $('#registryUrl').value = st?.localServersRegistryUrl || '';

    $('#btnSaveRegistry')?.addEventListener('click', saveRegistry);
    $('#btnRefresh')?.addEventListener('click', refresh);
    $('#btnOpen')?.addEventListener('click', openHost);
    $('#btnClose')?.addEventListener('click', closeHost);
    $('#btnOpenMinecraft')?.addEventListener('click', async () => {
      await window.noc.bedrockLaunch();
      setTimeout(checkBedrockStatus, 1200);
    });

    setInterval(checkBedrockStatus, 5000);
    await checkBedrockStatus();
    await refresh();
  }

  init();
})();
