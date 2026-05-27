const Dashboard = (() => {
  const kpiGrid          = document.getElementById('kpi-grid');
  const qualitySummary   = document.getElementById('data-quality-summary');
  const btnRun           = document.getElementById('btn-run-analysis');
  const analyzingInd     = document.getElementById('analyzing-indicator');
  const kpiCards         = document.getElementById('kpi-cards');
  const chartGrid        = document.getElementById('chart-grid');
  const btnExportExcel   = document.getElementById('btn-export-excel');
  const btnExportPptx    = document.getElementById('btn-export-pptx');

  let activeCharts = [];

  function initKpiSelection(quality) {
    App.availableKpis = quality.available_kpis || [];
    const blocked      = quality.blocked_kpis  || [];

    qualitySummary.innerHTML = `
      <div class="quality-row">
        <div class="quality-stat">
          <span class="quality-stat-val">${App.availableKpis.length}</span>
          <span class="quality-stat-label">KPIs Available</span>
        </div>
        <div class="quality-stat">
          <span class="quality-stat-val" style="color:var(--warning)">${blocked.length}</span>
          <span class="quality-stat-label">KPIs Blocked (missing data)</span>
        </div>
      </div>`;

    const availCards = App.availableKpis.map(id => `
      <div class="kpi-card-select selected" data-kpi-id="${id}">
        <div class="kpi-card-name">${fmtId(id)}</div>
        <div class="kpi-card-tags"><span class="kpi-tag">available</span></div>
      </div>`).join('');

    const blockedCards = blocked.map(b => `
      <div class="kpi-card-select blocked" title="Missing: ${b.missing_columns.join(', ')}">
        <div class="kpi-card-name">${fmtId(b.id)}</div>
        <div class="kpi-card-tags"><span class="kpi-tag blocked-tag">blocked</span></div>
        <div class="blocked-reason">Missing: ${b.missing_columns.join(', ')}</div>
      </div>`).join('');

    kpiGrid.innerHTML = availCards + blockedCards;
    App.selectedKpis = new Set(App.availableKpis);

    kpiGrid.querySelectorAll('.kpi-card-select:not(.blocked)').forEach(card => {
      card.addEventListener('click', () => toggleKpi(card.dataset.kpiId, card));
    });
  }

  function toggleKpi(id, el) {
    if (App.selectedKpis.has(id)) {
      App.selectedKpis.delete(id);
      el.classList.remove('selected');
    } else {
      App.selectedKpis.add(id);
      el.classList.add('selected');
    }
  }

  btnRun.addEventListener('click', async () => {
    if (!App.selectedKpis.size) { App.notify('Select at least one KPI.', 'info'); return; }
    btnRun.disabled = true;
    btnRun.textContent = 'Starting…';
    try {
      const res = await fetch(`/api/sessions/${App.sessionId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kpi_ids: Array.from(App.selectedKpis) }),
      });
      if (!res.ok) throw new Error(await res.text());
      App.goToStep(4);
      analyzingInd.classList.remove('hidden');
      pollStatus();
    } catch (err) {
      App.notify('Failed to start analysis: ' + err.message, 'error');
      btnRun.disabled = false;
      btnRun.textContent = 'Run Analysis';
    }
  });

  async function pollStatus() {
    try {
      const res  = await fetch(`/api/sessions/${App.sessionId}/status`);
      const data = await res.json();
      if (data.analysis_status === 'complete') {
        loadDashboard();
      } else if (data.analysis_status === 'error') {
        analyzingInd.classList.add('hidden');
        App.notify('Analysis failed. Please check your data and try again.', 'error');
      } else {
        setTimeout(pollStatus, 1500);
      }
    } catch {
      setTimeout(pollStatus, 2000);
    }
  }

  async function loadDashboard() {
    const res  = await fetch(`/api/sessions/${App.sessionId}/dashboard`);
    const data = await res.json();
    analyzingInd.classList.add('hidden');
    renderDashboard(data.kpi_results);
  }

  function renderDashboard(results) {
    activeCharts.forEach(c => c.destroy());
    activeCharts = [];
    kpiCards.innerHTML = '';
    chartGrid.innerHTML = '';

    Object.values(results).forEach(kpi => {
      if (kpi.error) return;
      const hasVal       = kpi.value !== null && kpi.value !== undefined;
      const hasBreakdown = kpi.breakdown && typeof kpi.breakdown === 'object' && Object.keys(kpi.breakdown).length;

      if (hasVal && !hasBreakdown) {
        kpiCards.insertAdjacentHTML('beforeend', `
          <div class="kpi-result-card">
            <div class="kpi-result-name">${kpi.name}</div>
            <div>
              <span class="kpi-result-val">${fmtVal(kpi.value)}</span>
              ${kpi.unit ? `<span class="kpi-result-unit"> ${kpi.unit}</span>` : ''}
            </div>
          </div>`);
      }

      if (hasBreakdown) {
        const cid = `chart-${kpi.kpi_id}`;
        chartGrid.insertAdjacentHTML('beforeend', `
          <div class="chart-card">
            <div class="chart-card-title">${kpi.name}</div>
            <div class="chart-canvas-wrap"><canvas id="${cid}"></canvas></div>
          </div>`);
        requestAnimationFrame(() => renderChart(cid, kpi));
      }
    });

    if (!kpiCards.innerHTML && !chartGrid.innerHTML) {
      kpiCards.innerHTML = '<p style="color:var(--text-muted);padding:1.5rem 0">No KPI results to display. Upload more complete data to unlock KPIs.</p>';
    }
  }

  function renderChart(canvasId, kpi) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const labels = Object.keys(kpi.breakdown).map(String);
    const values = Object.values(kpi.breakdown);
    const type   = kpi.chart_type === 'line' ? 'line' : kpi.chart_type === 'pie' ? 'pie' : 'bar';
    const colors = labels.map((_, i) => `hsl(${210 + i * 20}, 60%, ${48 + (i % 4) * 8}%)`);

    const chart = new Chart(canvas, {
      type,
      data: {
        labels,
        datasets: [{
          label: kpi.name,
          data: values,
          backgroundColor: type === 'line' ? 'rgba(31,78,121,.1)' : colors,
          borderColor:     type === 'line' ? '#1F4E79' : colors,
          borderWidth: 2,
          fill: type === 'line',
          tension: .35,
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: type === 'pie' } },
        scales: type === 'pie' ? {} : {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
          y: { beginAtZero: true },
        },
      },
    });
    activeCharts.push(chart);
  }

  btnExportExcel.addEventListener('click', () => {
    window.location.href = `/api/sessions/${App.sessionId}/export/excel`;
  });
  btnExportPptx.addEventListener('click', () => {
    window.location.href = `/api/sessions/${App.sessionId}/export/pptx`;
  });

  function fmtId(id) {
    return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  function fmtVal(v) {
    if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return String(v);
  }

  return { initKpiSelection };
})();
