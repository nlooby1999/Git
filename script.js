(() => {
  function init(){
    // Column positions from the manifest sheets
    const COL_SO = 4, COL_FP = 10, COL_CH = 11, COL_FL = 12;

    function MarkingModule(prefix){
      const fileEl         = document.getElementById(prefix + '_file');
      const fileMeta       = document.getElementById(prefix + '_file_meta');
      const scheduleFileEl = document.getElementById(prefix + '_schedule_file');
      const scheduleMeta   = document.getElementById(prefix + '_schedule_meta');
      const scanEl         = document.getElementById(prefix + '_scan');
      const clearEl        = document.getElementById(prefix + '_clear');
      const exportEl       = document.getElementById(prefix + '_export');
      const tableWrap      = document.getElementById(prefix + '_table');
      const scheduleWrap   = document.getElementById(prefix + '_schedule_table');
      const summaryEl      = document.getElementById(prefix + '_scanned_summary');
      const filterClearEl  = document.getElementById(prefix + '_filter_clear');

      const hasRunsheetUI = Boolean(fileEl && fileMeta && tableWrap);
      const hasScheduleUI = Boolean(scheduleFileEl && scheduleMeta && scheduleWrap);

      if (!scanEl || !clearEl || !exportEl) {
        return { focus: () => {} };
      }
      if (!hasRunsheetUI && !hasScheduleUI) {
        return { focus: () => {} };
      }

      const KEYS = {
        table:   `drm_${prefix}_table_v2`,
        gen:     `drm_${prefix}_generated_v2`,
        scanned: `drm_${prefix}_scanned_v2`,
        lookup:  `drm_${prefix}_rowlookup_v2`,
        files:   `drm_${prefix}_files_meta_v2`,
        schedule:`drm_${prefix}_schedule_v1`,
      };

      let tableData = [];
      let generated = {};
      let scanned   = {};
      let rowLookup = {};
      let statusEl  = null;
      let loadedFiles = [];
      let scheduleEntries = [];
      let filteredSO = null;
      let lastScanInfo = null;

      const normSO = v => (v == null ? '' : String(v).trim().toUpperCase());
      const extractSO = v => {
        const upper = String(v ?? '').toUpperCase();
        const match = upper.match(/SO\d+/);
        return match ? match[0] : '';
      };

      const MANIFEST_HEADERS = ['Run','Drop','Zone','Date','Sales Order','Name','Address','Suburb','Postcode','Phone Number','FP','CH','FL','Weight','Type'];

      if (filterClearEl) filterClearEl.style.display = 'none';
      if (summaryEl) summaryEl.style.display = 'none';

      function ensureStatus(){
        if (statusEl) return statusEl;
        statusEl = document.createElement('div');
        Object.assign(statusEl.style,{
          marginTop:'0.75rem',border:'1px solid rgba(148,163,184,.25)',borderRadius:'12px',
          padding:'12px 14px',background:'rgba(56,189,248,.08)',boxShadow:'inset 0 1px 0 rgba(255,255,255,.04)',
          fontSize:'1rem',letterSpacing:'0.01em'
        });
        const card = fileEl.closest('.card');
        const controls = card?.querySelector('.controls');
        if (card && controls) card.insertBefore(statusEl, controls.nextSibling);
        return statusEl;
      }

      function setStatus({so, run, drop, scannedCount, total}){
        const el = ensureStatus();
        const runText = run && run !== '-' ? run : '-';
        const dropText = drop && drop !== '-' ? drop : '-';
        const hasRoute = runText !== '-' || dropText !== '-';
        const routeText = hasRoute ? `Run ${runText} / Drop ${dropText}` : 'Not routed';
        let html = `
          <strong>Sales Order:</strong> <span>${so}</span>&nbsp;&middot;&nbsp;
          <strong>Route:</strong> <span style="font-size:1.2rem;font-weight:700;letter-spacing:.02em">${routeText}</span>
        `;
        if (hasRunsheetUI) {
          html += `&nbsp;&middot;&nbsp;<strong>Progress:</strong> <span>${scannedCount}/${total}</span>`;
        }
        el.innerHTML = html;
      }

      function toast(msg,type='info'){
        const el=document.createElement('div');
        el.textContent=msg;
        el.role='status';
        Object.assign(el.style,{
          position:'fixed',left:'50%',top:'16px',transform:'translateX(-50%)',
          padding:'10px 14px',borderRadius:'10px',zIndex:9999,fontSize:'14px',
          border:'1px solid rgba(148,163,184,.3)',backdropFilter:'blur(8px)',
          boxShadow:'0 10px 24px rgba(2,6,23,.4)',color:'#e2e8f0',background:'rgba(56,189,248,.12)'
        });
        if(type==='error'){el.style.background='rgba(248,113,113,.22)'; el.style.color='#fecaca';}
        if(type==='success'){el.style.background='rgba(74,222,128,.22)'; el.style.color='#bbf7d0';}
        document.body.appendChild(el);
        setTimeout(()=>el.remove(),1600);
      }

      function updateFileMeta(){
        if (!fileMeta) return;
        if (!loadedFiles.length) { fileMeta.textContent = 'No runsheet loaded.'; return; }
        const totalRows = loadedFiles.reduce((sum,file)=>sum+file.rows,0);
        fileMeta.textContent = `${loadedFiles.length} file(s) merged - ${totalRows.toLocaleString()} rows`;
      }

      function updateScheduleMeta(){
        if (!scheduleMeta) return;
        if (!scheduleEntries.length) {
          scheduleMeta.textContent = 'No production schedule loaded.';
          return;
        }
        const matched = scheduleEntries.reduce((sum, entry)=> sum + (rowLookup[entry.so]?.length ? 1 : 0), 0);
        let text = `${scheduleEntries.length} production order(s) loaded - ${matched} matched to runsheet.`;
        if (filteredSO){
          const visible = scheduleEntries.filter(entry => entry.so === filteredSO).length;
          text += ` Showing ${visible} for ${filteredSO}.`;
        }
        scheduleMeta.textContent = text;
      }

      function updateScanAvailability(){
        if (!scanEl) return;
        const hasGenerated = Object.values(generated).some(arr => Array.isArray(arr) && arr.length > 0);
        const shouldEnable = hasGenerated;
        const wasDisabled = scanEl.disabled;
        scanEl.disabled = !shouldEnable;
        if (shouldEnable && wasDisabled) focusScan();
      }

      function formatManifestRow(row){
        const cells = Array.isArray(row) ? [...row] : [];
        if (cells.length < MANIFEST_HEADERS.length){
          while (cells.length < MANIFEST_HEADERS.length) cells.push('');
        }else if (cells.length > MANIFEST_HEADERS.length){
          cells.length = MANIFEST_HEADERS.length;
        }
        return cells.map(cell => (cell ?? '') === '' ? '-' : String(cell));
      }

      function updateFilterUI(){
        if (!filterClearEl) return;
        filterClearEl.style.display = filteredSO ? '' : 'none';
      }

      function updateSummaryDisplay(){
        if (!summaryEl) return;
        if (!lastScanInfo || (hasScheduleUI && !scheduleEntries.length)){
          summaryEl.style.display = 'none';
          summaryEl.innerHTML = '';
          return;
        }
        const { so, run, drop } = lastScanInfo;
        const runText = run && run !== '-' ? run : '-';
        const dropText = drop && drop !== '-' ? drop : '-';
        const hasRoute = runText !== '-' || dropText !== '-';
        const routeText = hasRoute ? `Run ${runText} / Drop ${dropText}` : 'Not routed';
        summaryEl.style.display = '';
        summaryEl.innerHTML = `
          <strong>Scanned:</strong> <span>${so}</span>&nbsp;&middot;&nbsp;
          <strong>Route:</strong> <span>${routeText}</span>
        `;
      }

      function applyScheduleFilter(so){
        if (!hasScheduleUI) return;
        filteredSO = so;
        renderScheduleTable();
        updateScheduleMeta();
        updateScanAvailability();
        updateSummaryDisplay();
      }

      function clearScheduleFilter(){
        if (!hasScheduleUI) return;
        filteredSO = null;
        renderScheduleTable();
        updateScheduleMeta();
        updateScanAvailability();
        focusScan();
        updateSummaryDisplay();
      }

      function save(){
        try{
          const plainScanned = {};
          Object.entries(scanned).forEach(([k,v])=>plainScanned[k]=Array.from(v));
          localStorage.setItem(KEYS.scanned, JSON.stringify(plainScanned));
          if (hasRunsheetUI){
            localStorage.setItem(KEYS.table, JSON.stringify(tableData));
            localStorage.setItem(KEYS.gen, JSON.stringify(generated));
            localStorage.setItem(KEYS.lookup, JSON.stringify(rowLookup));
            localStorage.setItem(KEYS.files, JSON.stringify(loadedFiles));
            if (typeof window !== 'undefined'){
              window.dispatchEvent(new CustomEvent('drm:runsheet-updated', { detail: { prefix } }));
            }
          }
          if (hasScheduleUI){
            localStorage.setItem(KEYS.schedule, JSON.stringify(scheduleEntries));
          }
        }catch{}
      }

      function load(){
        try{
          const storedScanned = localStorage.getItem(KEYS.scanned);
          scanned = {};
          if (storedScanned){
            const plain = JSON.parse(storedScanned) || {};
            Object.entries(plain).forEach(([k,arr])=>scanned[k]=new Set(arr||[]));
          }

          if (hasRunsheetUI){
            const t=localStorage.getItem(KEYS.table);
            const g=localStorage.getItem(KEYS.gen);
            const l=localStorage.getItem(KEYS.lookup);
            const f=localStorage.getItem(KEYS.files);
            if(t && g && l){
              tableData = JSON.parse(t)||[];
              generated = JSON.parse(g)||{};
              rowLookup = JSON.parse(l)||{};
              loadedFiles = f ? JSON.parse(f) : [];
              if (tableData.length && tableWrap){
                renderTable();
                Object.keys(rowLookup).forEach(updateRowHighlight);
              }
            }else{
              tableData=[]; generated={}; rowLookup={}; loadedFiles=[];
              if (tableWrap) tableWrap.innerHTML='<div class="table-scroll"></div>';
              scanEl.disabled = true;
            }
          }else{
            tableData=[]; generated={}; rowLookup={}; loadedFiles=[];
            scanEl.disabled = true;
          }

          if (hasScheduleUI){
            const sched=localStorage.getItem(KEYS.schedule);
            scheduleEntries = sched ? JSON.parse(sched) : [];
          }else{
            scheduleEntries = [];
          }

          updateFileMeta();
          refreshSchedule();
          updateScanAvailability();
        }catch{
          tableData=[]; generated={}; rowLookup={}; loadedFiles=[];
          if (hasRunsheetUI && tableWrap) tableWrap.innerHTML='<div class="table-scroll"></div>';
          scanEl.disabled = true;
          if (hasScheduleUI) scheduleEntries = [];
          scanned = {};
          updateFileMeta();
          refreshSchedule();
          updateScanAvailability();
        }
      }

      function reset(clear=false){
        tableData=[]; generated={}; scanned={}; rowLookup={}; loadedFiles=[];
        if (hasScheduleUI) scheduleEntries=[];
        filteredSO = null;
        lastScanInfo = null;
        if (hasRunsheetUI && tableWrap) tableWrap.innerHTML='<div class="table-scroll"></div>';
        if (hasScheduleUI && scheduleWrap) scheduleWrap.innerHTML='<div class="table-scroll"></div>';
        scanEl.disabled = true;
        updateFilterUI();
        updateSummaryDisplay();
        if(clear){
          if (hasRunsheetUI){
            localStorage.removeItem(KEYS.table);
            localStorage.removeItem(KEYS.gen);
            localStorage.removeItem(KEYS.lookup);
            localStorage.removeItem(KEYS.files);
          }
          if (hasScheduleUI){
            localStorage.removeItem(KEYS.schedule);
          }
          localStorage.removeItem(KEYS.scanned);
        }
        updateFileMeta();
        refreshSchedule();
        updateScanAvailability();
      }

      function renderTable(){
        if (!hasRunsheetUI || !tableWrap) return;
        const headers = MANIFEST_HEADERS;
        rowLookup = {};
        let html = '<div class="table-scroll"><table><thead><tr>';
        headers.forEach(h=> html += `<th>${h}</th>`);
        html += '</tr></thead><tbody>';
        tableData.slice(1).forEach((row, idx)=>{
          html += `<tr id="${prefix}-row-${idx}">`;
          const cells = formatManifestRow(row);
          cells.forEach(cell=> html += `<td>${cell}</td>`);
          html += '</tr>';
          const so = normSO(row[COL_SO]);
          if (so) (rowLookup[so] ||= []).push(idx);
        });
        html += '</tbody></table></div>';
        tableWrap.innerHTML = html;
      }

      function renderScheduleTable(){
        if (!hasScheduleUI || !scheduleWrap) return;
        const headers = MANIFEST_HEADERS;
        const entries = filteredSO ? scheduleEntries.filter(entry => entry.so === filteredSO) : scheduleEntries;
        if (!entries.length){
          const message = filteredSO
            ? `No production orders found for ${filteredSO}.`
            : '';
          const body = message ? `<div style="padding:1rem;text-align:center;">${message}</div>` : '';
          scheduleWrap.innerHTML = `<div class="table-scroll">${body}</div>`;
          updateFilterUI();
          return;
        }
        let html = '<div class="table-scroll"><table><thead><tr>';
        headers.forEach(h=> html += `<th>${h}</th>`);
        html += '</tr></thead><tbody>';
        entries.forEach(entry=>{
          const idxs = rowLookup[entry.so] || [];
          const route = firstRunDrop(entry.so);
          const runText = route.run && route.run !== '-' ? route.run : '-';
          const dropText = route.drop && route.drop !== '-' ? route.drop : '-';
          if (idxs.length){
            idxs.forEach(idx=>{
              const row = tableData[idx+1] || [];
              const cells = formatManifestRow(row);
              html += '<tr>' + cells.map(cell=>`<td>${cell}</td>`).join('') + '</tr>';
            });
          }else{
            const cells = new Array(headers.length).fill('-');
            cells[0] = runText;
            cells[1] = dropText;
            cells[4] = entry.so || '-';
            cells[5] = entry.createdFrom || '-';
            html += '<tr>' + cells.map(cell=>`<td>${cell}</td>`).join('') + '</tr>';
          }
        });
        html += '</tbody></table></div>';
        scheduleWrap.innerHTML = html;
        updateFilterUI();
      }

      function syncExternalRunsheet(){
        if (hasRunsheetUI) return;
        try{
          const tableRaw = localStorage.getItem('drm_final_table_v2');
          const lookupRaw = localStorage.getItem('drm_final_rowlookup_v2');
          const genRaw    = localStorage.getItem('drm_final_generated_v2');
          tableData = tableRaw ? JSON.parse(tableRaw) || [] : [];
          rowLookup = lookupRaw ? JSON.parse(lookupRaw) || {} : {};
          if ((!lookupRaw || !Object.keys(rowLookup).length) && tableData.length){
            rowLookup = {};
            tableData.slice(1).forEach((row, idx)=>{
              const so = normSO(row[COL_SO]);
              if (so) (rowLookup[so] ||= []).push(idx);
            });
          }
          generated = genRaw ? JSON.parse(genRaw) || {} : {};
          if (!genRaw && tableData.length){
            buildBarcodes();
          }
        }catch{
          tableData=[]; rowLookup={}; generated={};
        }
      }

      function refreshSchedule(){
        if (!hasScheduleUI) return;
        syncExternalRunsheet();
        renderScheduleTable();
        updateScheduleMeta();
        updateScanAvailability();
        updateSummaryDisplay();
      }

      function updateRowHighlight(so){
        if (!hasRunsheetUI) return;
        const idxs=rowLookup[so];
        if(!idxs) return;
        const tot = generated[so]?.length ?? 0;
        const scn = scanned[so]?.size ?? 0;
        idxs.forEach(i=>{
          const tr = document.getElementById(`${prefix}-row-${i}`);
          if(!tr) return;
          tr.classList.remove('partial','completed');
          if(tot>0 && scn>=tot) tr.classList.add('completed');
          else if(scn>0) tr.classList.add('partial');
        });
      }

      function buildBarcodes(){
        generated={};
        tableData.slice(1).forEach(row=>{
          const so = normSO(row[COL_SO]);
          if(!so) return;
          const n = (v)=> Math.max(0, Number.isFinite(+v)?+v : parseInt(String(v),10)||0);
          const total = n(row[COL_FP]) + n(row[COL_CH]) + n(row[COL_FL]);
          if(total<=0) return;
          const arr = (generated[so] ||= []);
          const start = arr.length;
          for(let i=1;i<=total;i++) arr.push(`${so}${String(start+i).padStart(3,'0')}`);
        });
      }

      function firstRunDrop(so){
        const idxs=rowLookup[so];
        if(!idxs?.length) return {run:'-',drop:'-'};
        const row = tableData[idxs[0]+1] || [];
        return { run: String(row[0] ?? '-'), drop: String(row[1] ?? '-') };
      }

      function focusScan(){
        if(!scanEl.disabled) requestAnimationFrame(()=>scanEl.focus());
      }

      function shakeInput(){
        scanEl.style.transition='transform 0.08s ease';
        scanEl.style.transform='translateX(0)';
        let i=0;
        const t=setInterval(()=>{
          scanEl.style.transform=`translateX(${i%2===0?'-6px':'6px'})`;
          if(++i>6){clearInterval(t); scanEl.style.transform='translateX(0)';}
        },50);
      }

      async function readWorkbook(file){
        const buf = await file.arrayBuffer();
        const wb  = XLSX.read(buf,{type:'array'});
        const ws  = wb.Sheets[wb.SheetNames[0]];
        return XLSX.utils.sheet_to_json(ws,{header:1});
      }

      async function handleFiles(fileList){
        if (!hasRunsheetUI) return;
        if(!fileList || !fileList.length) return;
        if (typeof XLSX === 'undefined'){
          toast('Excel parser not available. Refresh the page or install the offline bundle.', 'error');
          fileEl.value = '';
          return;
        }
        try{
          const files = Array.from(fileList);
          const results = await Promise.all(files.map(f => readWorkbook(f).then(rows => ({ name:f.name, rows }))));
          if (!results.length || !results[0].rows?.length){
            toast('The selected workbook appears to be empty.', 'error');
            return;
          }

          let base = tableData.length ? tableData[0] : results[0].rows[0] || [];
          let merged = [ base ];
          let addedCount = 0;
          let newFilesMeta = [];

          if (tableData.length > 1) {
            merged = merged.concat(tableData.slice(1));
            addedCount += (tableData.length - 1);
          }

          results.forEach(r => {
            const body = (r.rows || []).slice(1);
            if (body.length) {
              merged = merged.concat(body);
              addedCount += body.length;
              newFilesMeta.push({ name: r.name, rows: body.length });
            }
          });

          tableData = merged;
          loadedFiles = (loadedFiles || []).concat(newFilesMeta);

          renderTable();
          buildBarcodes();
          scanEl.value = '';
          Object.keys(rowLookup).forEach(updateRowHighlight);
          refreshSchedule();
          updateFileMeta();
          updateScanAvailability();
          save();
          focusScan();
          toast(`Merged ${newFilesMeta.length} file(s), ${addedCount.toLocaleString()} rows.`, 'success');
        }catch(err){
          console.error(err);
          toast('Unable to read the selected workbook. Please verify the file format.', 'error');
        }finally{
          fileEl.value = '';
        }
      }

      async function handleSchedule(fileList){
        if (!hasScheduleUI) return;
        if(!fileList || !fileList.length) return;
        if (typeof XLSX === 'undefined'){
          toast('Excel parser not available. Refresh the page or install the offline bundle.', 'error');
          scheduleFileEl.value = '';
          return;
        }
        try{
          const file = fileList[0];
          const rows = await readWorkbook(file);
          if(!rows.length){
            toast('The production schedule appears to be empty.', 'error');
            scheduleEntries = [];
            refreshSchedule();
            save();
            return;
          }
          const headers = (rows[0] || []).map(v => String(v ?? '').trim().toLowerCase());
          const createdIdx = headers.findIndex(h => h === 'created from');
          if (createdIdx === -1){
            toast('Could not find a "Created From" column in the production schedule.', 'error');
            return;
          }
          const seen = new Set();
          const entries = [];
          rows.slice(1).forEach(row=>{
            const raw = row[createdIdx];
            if (raw == null || raw === '') return;
            const so = extractSO(raw);
            if (!so || seen.has(so)) return;
            seen.add(so);
            entries.push({ createdFrom: String(raw), so });
          });
          if (!entries.length){
            toast('No sales orders found in the production schedule.', 'error');
            filteredSO = null;
            scheduleEntries = [];
            refreshSchedule();
            save();
            return;
          }
          filteredSO = null;
          scheduleEntries = entries;
          refreshSchedule();
          updateScanAvailability();
          save();
          toast(`Loaded ${entries.length} production order(s).`,'success');
        }catch(err){
          console.error(err);
          toast('Unable to read the production schedule.', 'error');
        }finally{
          scheduleFileEl.value = '';
        }
      }

      function handleScan(raw){
        const s = raw ? String(raw).trim() : '';
        if(!s) return;
        if (s.length<=3){ toast('Barcode is too short.','error'); shakeInput(); return; }
        const code = s.toUpperCase();
        const so = code.slice(0,-3);
        const known = generated[so];
        if(!known || !known.includes(code)){ toast('Sales Order not found or barcode invalid.','error'); shakeInput(); return; }
        if(!scanned[so]) scanned[so]=new Set();
        const preventDuplicates = hasRunsheetUI;
        if (preventDuplicates && scanned[so].has(code)){
          toast('This barcode has already been scanned.','info');
          focusScan();
          return;
        }
        scanned[so].add(code);
        const scannedCount = scanned[so].size;
        const total = known.length;
        const {run, drop} = firstRunDrop(so);
        setStatus({so, run, drop, scannedCount, total});
        if (hasScheduleUI && !hasRunsheetUI) applyScheduleFilter(so);
        updateRowHighlight(so);
        lastScanInfo = { so, run, drop };
        updateSummaryDisplay();
        save();
        focusScan();
        const statusText = hasRunsheetUI
          ? `Marked 1 / ${total} for ${so}`
          : `Run ${run || '-'} / Drop ${drop || '-'} for ${so}`;
        toast(statusText,'success');
      }

      scanEl.addEventListener('keydown', (e)=>{
        if(e.key==='Enter'){
          handleScan(e.target.value);
          e.target.value='';
        }
      });

      if (fileEl) fileEl.addEventListener('change', (e)=>{ handleFiles(e.target.files); });
      if (scheduleFileEl) scheduleFileEl.addEventListener('change', (e)=>{ handleSchedule(e.target.files); });
      if (filterClearEl){
        filterClearEl.addEventListener('click', ()=>{ clearScheduleFilter(); });
        filterClearEl.addEventListener('keydown', (event)=>{
          if (event.key === 'Enter' || event.key === ' '){
            event.preventDefault();
            clearScheduleFilter();
          }
        });
      }

      clearEl.addEventListener('click', ()=>{
        if(!confirm('Clear this marking tab?')) return;
        reset(true);
        scanEl.value='';
        if (hasRunsheetUI && fileEl) fileEl.value='';
        if (hasScheduleUI && scheduleFileEl) scheduleFileEl.value='';
        toast('Cleared.','success');
      });

      if (hasScheduleUI && !hasRunsheetUI && typeof window !== 'undefined'){
        window.addEventListener('drm:runsheet-updated', refreshSchedule);
      }

      exportEl.addEventListener('click', ()=>{
        if(!tableData.length){ toast('Upload manifest(s) before exporting.','error'); return; }
        const headers = MANIFEST_HEADERS;
        const completed=[];
        tableData.slice(1).forEach(row=>{
          const so=normSO(row[COL_SO]);
          const expected=generated[so];
          if(!expected?.length) return;
          const count=scanned[so]?.size ?? 0;
          if(count===expected.length) completed.push(row);
        });
        if(!completed.length){ toast('No completed consignments yet.','info'); return; }
        const esc=v=>{ const s=(v??'')===''?'-':String(v); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
        let csv = headers.join(',') + '\n';
        completed.forEach(r => { csv += r.slice(0, headers.length).map(esc).join(',') + '\n'; });
        const blob = new Blob([csv],{type:'text/csv;charset=utf-8'});
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download=`${prefix}_completed_consignments.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(a.href),0);
      });

      load();

      return { focus: ()=>{ if(!scanEl.disabled) scanEl.focus(); } };
    }

    const finalModule = MarkingModule('final');
    const glueModule  = MarkingModule('glue');

    function activate(which){
      const map = {
        final: {tab:'#tab-final', panel:'#panel-final', focus: finalModule.focus},
        glue:  {tab:'#tab-glue',  panel:'#panel-glue',  focus: glueModule.focus}
      };
      const finalTab = document.querySelector('#tab-final');
      const glueTab  = document.querySelector('#tab-glue');
      const finalPanel = document.querySelector('#panel-final');
      const gluePanel  = document.querySelector('#panel-glue');
      if (!finalTab || !glueTab || !finalPanel || !gluePanel) return;
      finalTab.setAttribute('aria-selected','false');
      glueTab.setAttribute('aria-selected','false');
      finalPanel.classList.remove('active');
      gluePanel.classList.remove('active');
      const conf = map[which];
      document.querySelector(conf.tab)?.setAttribute('aria-selected','true');
      document.querySelector(conf.panel)?.classList.add('active');
      conf.focus();
    }

    document.getElementById('tab-final')?.addEventListener('click', ()=>activate('final'));
    document.getElementById('tab-glue')?.addEventListener('click',  ()=>activate('glue'));

    window.addEventListener('focus', ()=>{
      const active = document.querySelector('.panel.active');
      if (active?.id === 'panel-final') finalModule.focus();
      if (active?.id === 'panel-glue')  glueModule.focus();
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }
})();





