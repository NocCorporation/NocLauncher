(() => {
  const $ = (s) => document.querySelector(s);

  function setHostStatus(t) { const el = $('#hostStatus'); if (el) el.textContent = t; }

  async function refresh() {
    const root = $('#servers');
    if (!root) return;
    root.innerHTML = '<div class="meta">Загрузка...</div>';
    const r = await window.noc.localServersList();
    if (!r?.ok) {
      root.innerHTML = `<div class="meta">Реестр не найден (${r?.error || 'unknown'}). Подними registry:start на сервере.</div>`;
      return;
    }
    const list = Array.isArray(r.servers) ? r.servers : [];
    if (!list.length) {
      root.innerHTML = '<div class="meta">Пока нет активных миров.</div>';
      return;
    }
    root.innerHTML = list.map((s, i) => {
      const name = String(s.worldName || `Server #${i+1}`);
      const host = String(s.hostName || 'unknown');
      const ip = String(s.connect?.ip || '');
      const port = Number(s.connect?.port || 19132);
      const ver = String(s.gameVersion || 'bedrock');
      const disabled = !ip;
      return `<div class="item">
        <div>
          <div class="name">${name}</div>
          <div class="meta">Host: ${host} • ${ip ? `${ip}:${port}` : 'адрес скрыт'} • ${ver}</div>
        </div>
        <button class="btn ${disabled ? '' : 'acc'}" data-ip="${ip}" data-port="${port}" ${disabled ? 'disabled' : ''}>Войти</button>
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
    if (!s.bedrockRunning) {
      setHostStatus('Bedrock не запущен. Хост включится автоматически, когда зайдёшь в мир.');
    } else if (!s.worldOpen) {
      setHostStatus('Bedrock запущен. Зайди в обычный мир — хост включится автоматически.');
    } else if (s.autoHosting) {
      setHostStatus('Мир обнаружен. Авто-хост активен ✅');
    } else {
      setHostStatus('Мир обнаружен. Запускаю авто-хост...');
    }
  }

  async function init() {
    $('#btnRefresh')?.addEventListener('click', refresh);
    $('#btnOpenMinecraft')?.addEventListener('click', async () => {
      await window.noc.bedrockLaunch();
      setTimeout(checkBedrockStatus, 1200);
    });
    $('#btnCloseWin')?.addEventListener('click', () => window.close());

    setInterval(async () => {
      await checkBedrockStatus();
      await refresh();
    }, 5000);

    await checkBedrockStatus();
    await refresh();
  }

  init();
})();
