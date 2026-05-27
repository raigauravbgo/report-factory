const App = {
  sessionId: null,
  currentStep: 1,
  mappingData: null,
  dataQuality: null,
  availableKpis: [],
  selectedKpis: new Set(),

  goToStep(n) {
    document.querySelectorAll('.step-panel').forEach(p => {
      p.classList.remove('active');
      p.classList.add('hidden');
    });
    document.querySelectorAll('.step[data-step]').forEach(s => {
      const num = parseInt(s.dataset.step);
      s.classList.remove('active', 'done');
      if (num < n) s.classList.add('done');
      if (num === n) s.classList.add('active');
    });
    const panel = document.getElementById(`step-${n}`);
    if (panel) {
      panel.classList.remove('hidden');
      panel.classList.add('active');
    }
    this.currentStep = n;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  notify(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },

  setSessionId(id) {
    this.sessionId = id;
    document.getElementById('session-id-display').textContent = id.slice(0, 8) + '…';
    document.getElementById('session-info').classList.remove('hidden');
  },
};
