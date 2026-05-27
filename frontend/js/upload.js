(function () {
  const dropZone      = document.getElementById('drop-zone');
  const fileInput     = document.getElementById('file-input');
  const fileList      = document.getElementById('file-list');
  const uploadActions = document.getElementById('upload-actions');
  const btnUpload     = document.getElementById('btn-upload');
  const spinner       = document.getElementById('upload-spinner');

  const FILE_TYPE_OPTIONS = [
    { value: 'unknown',          label: 'Auto-detect' },
    { value: 'call_log',         label: 'Call Log / Dialer Data' },
    { value: 'staffing',         label: 'Staffing Schedule' },
    { value: 'customer_profile', label: 'Customer Profile' },
    { value: 'revenue',          label: 'Revenue Data' },
    { value: 'lms',              label: 'LMS Data' },
    { value: 'campaign',         label: 'Campaign Data' },
    { value: 'other',            label: 'Other' },
  ];

  let pendingFiles = [];

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragging'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragging');
    addFiles(Array.from(e.dataTransfer.files));
  });
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { addFiles(Array.from(fileInput.files)); fileInput.value = ''; });

  function addFiles(files) {
    files.forEach(f => {
      if (!pendingFiles.find(p => p.name === f.name)) pendingFiles.push(f);
    });
    render();
  }

  function render() {
    if (!pendingFiles.length) {
      fileList.classList.add('hidden');
      uploadActions.classList.add('hidden');
      return;
    }
    fileList.classList.remove('hidden');
    uploadActions.classList.remove('hidden');

    fileList.innerHTML = pendingFiles.map((f, i) => `
      <div class="file-item">
        <div class="file-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
          </svg>
        </div>
        <div class="file-meta">
          <div class="file-name">${f.name}</div>
          <div class="file-size">${formatBytes(f.size)}</div>
        </div>
        <select class="file-type-select" data-index="${i}">
          ${FILE_TYPE_OPTIONS.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
        </select>
        <button class="file-remove" data-index="${i}" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>`).join('');

    fileList.querySelectorAll('.file-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        pendingFiles.splice(parseInt(btn.dataset.index), 1);
        render();
      });
    });
  }

  btnUpload.addEventListener('click', async () => {
    if (!pendingFiles.length) return;
    btnUpload.disabled = true;
    spinner.classList.remove('hidden');

    const form = new FormData();
    const types = [];
    pendingFiles.forEach((f, i) => {
      form.append('files', f);
      const sel = fileList.querySelector(`select[data-index="${i}"]`);
      types.push(sel ? sel.value : 'unknown');
    });
    form.append('file_types', JSON.stringify(types));

    try {
      const res = await fetch('/api/sessions', { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      App.setSessionId(data.session_id);
      App.mappingData = {};
      data.mapping_suggestions.forEach(s => Object.assign(App.mappingData, s.mapping));
      Mapping.init(App.mappingData);
      App.goToStep(2);
    } catch (err) {
      App.notify('Upload failed: ' + err.message, 'error');
    } finally {
      btnUpload.disabled = false;
      spinner.classList.add('hidden');
    }
  });

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1_048_576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1_048_576).toFixed(1) + ' MB';
  }
})();
