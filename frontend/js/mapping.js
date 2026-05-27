const Mapping = (() => {
  const tbody      = document.getElementById('mapping-tbody');
  const btnConfirm = document.getElementById('btn-confirm-mapping');

  let current = {};

  function init(mappingData) {
    current = JSON.parse(JSON.stringify(mappingData));
    render();
  }

  function render() {
    tbody.innerHTML = Object.entries(current).map(([col, info]) => {
      const conf    = info.confidence || 0;
      const pct     = Math.round(conf * 100);
      const fillCls = conf >= 0.8 ? 'high' : conf >= 0.5 ? 'medium' : 'low';
      const badgeCls = {
        auto: 'badge-auto', review_needed: 'badge-review',
        manual: 'badge-manual', ignored: 'badge-ignored',
      }[info.status] || 'badge-review';

      return `<tr data-col="${col}">
        <td><code style="font-size:.8rem">${col}</code></td>
        <td>
          <input class="mapping-input" type="text"
            value="${info.canonical_name || ''}"
            data-field="canonical_name"
            placeholder="e.g. call_id" />
        </td>
        <td>
          <div class="confidence-bar-wrap">
            <div class="confidence-bar">
              <div class="confidence-fill ${fillCls}" style="width:${pct}%"></div>
            </div>
            <span class="confidence-val">${pct}%</span>
          </div>
        </td>
        <td><span class="${badgeCls}">${info.status || 'review_needed'}</span></td>
        <td>
          <select class="status-select" data-field="status">
            <option value="auto"          ${info.status === 'auto'          ? 'selected' : ''}>Auto</option>
            <option value="review_needed" ${info.status === 'review_needed' ? 'selected' : ''}>Review</option>
            <option value="manual"        ${info.status === 'manual'        ? 'selected' : ''}>Manual</option>
            <option value="ignored"       ${info.status === 'ignored'       ? 'selected' : ''}>Ignore</option>
          </select>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-col]').forEach(row => {
      const col = row.dataset.col;
      row.querySelector('[data-field="canonical_name"]').addEventListener('input', e => {
        current[col].canonical_name = e.target.value;
        current[col].status = 'manual';
        row.querySelector('[data-field="status"]').value = 'manual';
      });
      row.querySelector('[data-field="status"]').addEventListener('change', e => {
        current[col].status = e.target.value;
      });
    });
  }

  btnConfirm.addEventListener('click', async () => {
    btnConfirm.disabled = true;
    btnConfirm.textContent = 'Confirming…';
    try {
      const res = await fetch(`/api/sessions/${App.sessionId}/mapping/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns: current }),
      });
      if (!res.ok) throw new Error(await res.text());
      const quality = await res.json();
      App.dataQuality = quality;
      Dashboard.initKpiSelection(quality);
      App.goToStep(3);
    } catch (err) {
      App.notify('Failed to confirm mapping: ' + err.message, 'error');
    } finally {
      btnConfirm.disabled = false;
      btnConfirm.textContent = 'Confirm & Continue';
    }
  });

  return { init };
})();
