(function () {
  "use strict";
  const Solver = window.GridStrategySolver;
  const STORAGE_KEY = "grid-strategy-lab-v1";
  const APPEARANCE_KEY = "grid-strategy-lab-appearance-v1";
  const WALLPAPERS = {
    "blue-recollection": "assets/wallpapers/blue-recollection.png",
    "highlander-train": "assets/wallpapers/highlander-train.png",
    hina: "assets/wallpapers/hina.jpg",
  };
  const defaultState = () => ({
    rows: 5,
    cols: 9,
    mode: "unknown",
    cells: Array(45).fill("unknown"),
    shapes: [
      { id: "s-12", w: 2, h: 1, count: 3, rotate: true },
      { id: "s-13", w: 3, h: 1, count: 1, rotate: true },
      { id: "s-23", w: 3, h: 2, count: 1, rotate: true },
    ],
  });

  let state = loadState();
  let result = null;
  let solveTimer = null;
  let inputTool = "paint";
  let gesture = null;
  let history = [];
  let future = [];
  let recognition = { image: null, boardCrop: null, inventoryCrop: null, activeZone: "board", cells: null, shapes: [] };
  let presetSelection = { start: 0, end: 0, dragging: false };

  const $ = (id) => document.getElementById(id);
  const elements = {
    rows: $("rowsInput"), cols: $("colsInput"), shapeList: $("shapeList"), board: $("board"),
    metric: $("metricSelect"), notice: $("notice"), solve: $("solveButton"),
    bestCell: $("bestCell"), bestDetail: $("bestDetail"), bestProbability: $("bestProbability"),
    expectedFlips: $("expectedFlips"), plannerLabel: $("plannerLabel"), layoutCount: $("layoutCount"),
    layoutLabel: $("layoutLabel"), legendLow: $("legendLow"), legendHigh: $("legendHigh"),
  };

  function snapshot() { return JSON.stringify({ rows: state.rows, cols: state.cols, cells: state.cells, shapes: state.shapes }); }
  function restoreSnapshot(value) {
    const saved = JSON.parse(value);
    Object.assign(state, saved);
    elements.rows.value = state.rows; elements.cols.value = state.cols;
    renderShapes(); renderBoard(); saveState(); scheduleSolve(); updateHistoryButtons();
  }
  function pushHistory(before) {
    if (before === snapshot()) return;
    history.push(before); if (history.length > 60) history.shift();
    future = []; updateHistoryButtons();
  }
  function updateHistoryButtons() {
    $("undoButton").disabled = !history.length;
    $("redoButton").disabled = !future.length;
  }
  function undo() { if (!history.length) return; future.push(snapshot()); restoreSnapshot(history.pop()); }
  function redo() { if (!future.length) return; history.push(snapshot()); restoreSnapshot(future.pop()); }
  function toast(message) {
    let node = document.querySelector(".toast");
    if (!node) { node = document.createElement("div"); node.className = "toast"; document.body.appendChild(node); }
    node.textContent = message; node.classList.add("show");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 1900);
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.rows * saved.cols === saved.cells.length) return saved;
    } catch (_) { /* start clean */ }
    return defaultState();
  }
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function defaultAppearance() { return { version: 2, wallpaper: "blue-recollection", blur: 8, dim: 48, panel: 52, controlTransparency: 20, foundStyle: "dark" }; }
  function loadAppearance() {
    try {
      const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || "{}");
      if (saved.version !== 2) {
        saved.version = 2;
        saved.blur = 8;
        saved.panel = 52;
        saved.controlTransparency = saved.controls == null ? 20 : 100 - saved.controls;
      }
      return { ...defaultAppearance(), ...saved };
    }
    catch (_) { return defaultAppearance(); }
  }
  let appearance = loadAppearance();
  function applyAppearance() {
    const wallpaper = appearance.wallpaper === "custom" ? appearance.custom : WALLPAPERS[appearance.wallpaper] || WALLPAPERS["blue-recollection"];
    document.documentElement.style.setProperty("--wallpaper-image", `url("${wallpaper}")`);
    document.documentElement.style.setProperty("--wallpaper-blur", `${appearance.blur}px`);
    document.documentElement.style.setProperty("--wallpaper-dim", (appearance.dim / 100).toFixed(2));
    document.documentElement.style.setProperty("--panel-opacity", (appearance.panel / 100).toFixed(2));
    const controlOpacity = 1 - appearance.controlTransparency / 100;
    document.documentElement.style.setProperty("--control-opacity", controlOpacity.toFixed(2));
    document.documentElement.style.setProperty("--control-percent", `${Math.round(controlOpacity * 100)}%`);
    $("wallpaperBlur").value = appearance.blur; $("wallpaperBlurValue").value = appearance.blur;
    $("wallpaperDim").value = appearance.dim; $("wallpaperDimValue").value = appearance.dim;
    $("panelOpacity").value = appearance.panel; $("panelOpacityValue").value = appearance.panel;
    $("controlTransparency").value = appearance.controlTransparency; $("controlTransparencyValue").value = appearance.controlTransparency;
    document.body.dataset.foundStyle = appearance.foundStyle;
    $("foundSkinToggle").setAttribute("aria-pressed", String(appearance.foundStyle === "xiaotao"));
    $("foundSkinToggle").querySelector("span").textContent = `物品格：${appearance.foundStyle === "xiaotao" ? "王小桃" : "深色"}`;
    $("foundSkinToggle").querySelector("small").textContent = appearance.foundStyle === "xiaotao" ? "切回深色" : "切换王小桃";
    document.querySelectorAll(".wallpaper-preset").forEach((button) => button.classList.toggle("active", button.dataset.wallpaper === appearance.wallpaper));
  }
  function saveAppearance() {
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)); }
    catch (_) { toast("壁纸较大，本次可用但无法永久保存"); }
  }
  function useWallpaperFile(file) {
    if (!file?.type.startsWith("image/")) return;
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1920 / image.naturalWidth, 1080 / image.naturalHeight);
      const canvas = document.createElement("canvas"); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      appearance = { ...appearance, wallpaper: "custom", custom: canvas.toDataURL("image/jpeg", .86) };
      applyAppearance(); saveAppearance(); toast("自定义壁纸已应用");
      URL.revokeObjectURL(image.src);
    };
    image.src = URL.createObjectURL(file);
  }
  function uid() { return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function cellName(cell) { return `R${Math.floor(cell / state.cols) + 1}C${cell % state.cols + 1}`; }

  function renderShapes() {
    elements.shapeList.innerHTML = "";
    state.shapes.forEach((shape) => {
      const row = document.createElement("div");
      row.className = "shape-row";
      row.innerHTML = `
        <input data-field="w" type="number" min="1" max="12" value="${shape.w}" aria-label="物体宽度">
        <span class="times">×</span>
        <input data-field="h" type="number" min="1" max="10" value="${shape.h}" aria-label="物体高度">
        <label class="count-field"><input data-field="count" type="number" min="0" max="10" value="${shape.count}" aria-label="剩余数量"></label>
        <button class="remove-shape" type="button" aria-label="删除这种尺寸">×</button>
        <label class="rotate-field"><input data-field="rotate" type="checkbox" ${shape.rotate ? "checked" : ""}>允许旋转（横放 / 竖放）</label>`;
      row.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
        const before = snapshot();
        const field = input.dataset.field;
        shape[field] = field === "rotate" ? input.checked : Math.max(field === "count" ? 0 : 1, Number(input.value) || 0);
        pushHistory(before); saveState(); scheduleSolve();
      }));
      row.querySelector(".remove-shape").addEventListener("click", () => {
        const before = snapshot();
        state.shapes = state.shapes.filter((item) => item.id !== shape.id);
        pushHistory(before); renderShapes(); saveState(); scheduleSolve();
      });
      elements.shapeList.appendChild(row);
    });
  }

  function colorFor(value, min, max, invert) {
    if (!Number.isFinite(value)) return "#edf1f8";
    let t = max > min ? (value - min) / (max - min) : 1;
    if (invert) t = 1 - t;
    t = clamp(t, 0, 1);
    const stops = [[237,242,250], [38,205,206], [255,226,103]];
    const segment = t < .5 ? 0 : 1;
    const local = segment === 0 ? t * 2 : (t - .5) * 2;
    const a = stops[segment], b = stops[segment + 1];
    const rgb = a.map((channel, i) => Math.round(channel + (b[i] - channel) * local));
    return `rgb(${rgb.join(",")})`;
  }

  function metricDisplay(cell, metric) {
    if (!result || !result.ok) return { text: "", value: null };
    const value = result[metric][cell];
    if (metric === "probability") return { text: `${(value * 100).toFixed(value >= .1 ? 0 : 1)}%`, value };
    if (metric === "expectedReveal") return { text: value.toFixed(2), value };
    return { text: Number.isFinite(value) ? value.toFixed(2) : "—", value };
  }

  function renderBoard() {
    const metric = elements.metric.value;
    elements.board.style.setProperty("--cols", state.cols);
    elements.board.innerHTML = "";
    const values = state.cells.map((cellState, index) => cellState === "unknown" ? metricDisplay(index, metric).value : null)
      .filter(Number.isFinite);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    const invert = metric === "strategy";
    elements.legendLow.textContent = metric === "strategy" ? "较差" : "低";
    elements.legendHigh.textContent = metric === "strategy" ? "更优" : "高";

    state.cells.forEach((cellState, index) => {
      const button = document.createElement("button");
      const display = metricDisplay(index, metric);
      const isBest = result?.bestCells?.includes(index) && cellState === "unknown";
      button.type = "button";
      button.className = `cell ${cellState}${isBest ? " best" : ""}`;
      button.style.setProperty("--heat", cellState === "unknown" ? colorFor(display.value, min, max, invert) : "");
      const mark = cellState === "miss" ? "空格" : cellState === "found" ? "物品" : display.text;
      button.innerHTML = `<span class="cell-coordinate">${cellName(index)}</span><span class="${cellState === "unknown" ? "cell-value" : "state-mark"}">${mark}</span>`;
      button.setAttribute("aria-label", `${cellName(index)}，${mark || "待计算"}`);
      button.dataset.index = index;
      if (gesture?.indices?.includes(index)) button.classList.add("selecting");
      elements.board.appendChild(button);
    });
  }

  function rectangleIndices(a, b) {
    const ar = Math.floor(a / state.cols), ac = a % state.cols;
    const br = Math.floor(b / state.cols), bc = b % state.cols;
    const indices = [];
    for (let r = Math.min(ar, br); r <= Math.max(ar, br); r += 1) {
      for (let c = Math.min(ac, bc); c <= Math.max(ac, bc); c += 1) indices.push(r * state.cols + c);
    }
    return indices;
  }

  function addShapeFromSelection(indices) {
    const rows = indices.map((i) => Math.floor(i / state.cols));
    const cols = indices.map((i) => i % state.cols);
    const h = Math.max(...rows) - Math.min(...rows) + 1;
    const w = Math.max(...cols) - Math.min(...cols) + 1;
    const match = state.shapes.find((shape) => (shape.w === w && shape.h === h) || (shape.rotate && shape.w === h && shape.h === w));
    if (match) match.count += 1;
    else state.shapes.push({ id: uid(), w, h, count: 1, rotate: w !== h });
    renderShapes();
    toast(`已添加 ${w}×${h} 物品${match ? "，数量 +1" : ""}`);
  }

  function beginGesture(index, pointerId) {
    gesture = { start: index, last: index, pointerId, before: snapshot(), indices: [index] };
    elements.board.setPointerCapture?.(pointerId);
    if (inputTool === "paint") {
      state.cells[index] = state.mode;
      renderBoard();
    } else renderBoard();
  }
  function moveGesture(index) {
    if (!gesture || index < 0 || index >= state.cells.length || gesture.last === index) return;
    gesture.last = index;
    if (inputTool === "paint") {
      if (!gesture.indices.includes(index)) gesture.indices.push(index);
      state.cells[index] = state.mode;
    } else gesture.indices = rectangleIndices(gesture.start, index);
    renderBoard();
  }
  function finishGesture() {
    if (!gesture) return;
    if (inputTool === "box") gesture.indices.forEach((index) => { state.cells[index] = state.mode; });
    if (inputTool === "object") addShapeFromSelection(gesture.indices);
    const before = gesture.before;
    gesture = null; pushHistory(before); saveState(); renderBoard(); scheduleSolve();
  }

  function evidenceMask(kind) {
    return state.cells.reduce((mask, value, index) => value === kind ? mask | Solver.bit(index) : mask, 0n);
  }

  function updateSummary() {
    if (!result?.ok) {
      elements.bestCell.textContent = "无解";
      elements.bestDetail.textContent = "请检查尺寸、数量或已知格";
      elements.bestProbability.textContent = "—";
      elements.expectedFlips.textContent = "—";
      elements.layoutCount.textContent = "0";
      elements.layoutLabel.textContent = "没有符合全部条件的布局";
      elements.notice.className = "notice error";
      elements.notice.textContent = "当前信息互相矛盾：剩余物体无法放入棋盘。可恢复部分格子、减少数量或检查尺寸。";
      return;
    }
    const best = result.bestCells[0];
    const bestProbability = Math.max(...result.probability, 0);
    elements.bestCell.textContent = result.bestCells.length ? result.bestCells.map(cellName).slice(0, 3).join(" / ") : "已完成";
    elements.bestDetail.textContent = result.bestCells.length > 3 ? `另有 ${result.bestCells.length - 3} 个并列最优格` : "粉色描边为并列推荐";
    elements.bestProbability.textContent = `${(bestProbability * 100).toFixed(1)}%`;
    elements.expectedFlips.textContent = Number.isFinite(result.expectedRemainingFlips) ? result.expectedRemainingFlips.toFixed(2) : "—";
    elements.plannerLabel.textContent = result.plannerMode === "exact" ? "严格动态规划最优值" : "两步前瞻估计值";
    elements.layoutCount.textContent = result.layouts.toLocaleString("zh-CN");
    elements.layoutLabel.textContent = result.layoutMode === "exact" ? "已完整枚举，后验为精确值" : "合法布局采样，后验为近似值";
    elements.notice.className = "notice";
    if (result.layoutMode === "exact" && result.plannerMode === "exact") {
      elements.notice.textContent = "当前状态规模较小：概率与全局策略均为严格精确结果。";
    } else if (result.layoutMode === "exact") {
      elements.notice.textContent = "格子概率已完整枚举；全局策略空间较大，预计翻数采用两步前瞻近似。";
    } else if (result.samplingFallback === "enumerated-prefix") {
      elements.notice.textContent = `已知物品格约束较强：已保留 ${result.layouts.toLocaleString("zh-CN")} 个确认合法的布局作为近似后验；结果不是矛盾，但建议继续校正物品边界。`;
    } else {
      const error = (result.maxSampleError95 * 100).toFixed(1);
      elements.notice.textContent = `组合数量很大：已采样 ${result.layouts.toLocaleString("zh-CN")} 个合法布局。单格概率的保守 95% 抽样误差上界约 ±${error} 个百分点，策略为两步前瞻近似。`;
    }
  }

  function solveNow() {
    clearTimeout(solveTimer);
    elements.solve.disabled = true;
    elements.solve.firstElementChild.textContent = "计算中…";
    requestAnimationFrame(() => setTimeout(() => {
      try {
        result = Solver.solve({
          rows: state.rows,
          cols: state.cols,
          shapes: state.shapes,
          forbiddenMask: evidenceMask("miss"),
          requiredMask: evidenceMask("found"),
        }, {
          exactLayoutLimit: 20000,
          sampleTarget: 3500,
          lookaheadDepth: 2,
          beamWidth: 7,
        });
        updateSummary(); renderBoard();
      } catch (error) {
        console.error(error);
        elements.notice.className = "notice error";
        elements.notice.textContent = "计算遇到异常，请缩小棋盘或减少物体数量后重试。";
      } finally {
        elements.solve.disabled = false;
        elements.solve.firstElementChild.textContent = "重新计算策略";
      }
    }, 20));
  }
  function scheduleSolve() { clearTimeout(solveTimer); solveTimer = setTimeout(solveNow, 260); }

  function applySize() {
    const before = snapshot();
    const rows = clamp(Math.floor(Number(elements.rows.value) || 5), 1, 10);
    const cols = clamp(Math.floor(Number(elements.cols.value) || 9), 1, 12);
    const next = Array(rows * cols).fill("unknown");
    for (let r = 0; r < Math.min(rows, state.rows); r += 1) {
      for (let c = 0; c < Math.min(cols, state.cols); c += 1) next[r * cols + c] = state.cells[r * state.cols + c];
    }
    state.rows = rows; state.cols = cols; state.cells = next;
    elements.rows.value = rows; elements.cols.value = cols;
    pushHistory(before); saveState(); renderBoard(); solveNow();
  }

  function openImageDialog() { $("imageDialog").hidden = false; setTimeout(() => $("imageFileInput").focus(), 0); }
  function closeImageDialog() { $("imageDialog").hidden = true; }
  function loadRecognitionFile(file) {
    if (!file || !file.type.startsWith("image/")) { toast("请选择图片文件"); return; }
    const image = new Image();
    image.onload = () => {
      recognition = { image, boardCrop: null, inventoryCrop: null, activeZone: "board", cells: null, shapes: [] };
      $("recognitionRows").value = state.rows;
      $("recognitionCols").value = state.cols;
      $("imageDropzone").hidden = true;
      $("recognitionWorkspace").hidden = false;
      autoCrop();
      $("recognitionStatus").textContent = `${image.naturalWidth} × ${image.naturalHeight}，等待识别`;
      $("applyRecognitionButton").disabled = true;
      $("recognitionResult").hidden = true;
    };
    image.onerror = () => toast("图片读取失败");
    image.src = URL.createObjectURL(file);
  }
  function canvasPoint(event) {
    const canvas = $("recognitionCanvas"), rect = canvas.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) * canvas.width / rect.width, 0, canvas.width), y: clamp((event.clientY - rect.top) * canvas.height / rect.height, 0, canvas.height) };
  }
  function locateBoardFromPixels(image, rows, cols) {
    const canvas=document.createElement("canvas"),scale=Math.min(1,640/image.naturalWidth);
    canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,w=canvas.width,h=canvas.height;
    const integral=new Uint32Array((w+1)*(h+1)),gradX=new Uint32Array((w+1)*(h+1)),gradY=new Uint32Array((w+1)*(h+1));
    for(let y=0;y<h;y+=1){let rowSum=0,rowGX=0,rowGY=0;for(let x=0;x<w;x+=1){const p=(y*w+x)*4,r=pixels[p],g=pixels[p+1],b=pixels[p+2],max=Math.max(r,g,b),min=Math.min(r,g,b);rowSum+=(max-min>42&&max>115)?1:0;if(x>0)rowGX+=Math.abs(r-pixels[p-4])+Math.abs(g-pixels[p-3])+Math.abs(b-pixels[p-2]);if(y>0){const up=p-w*4;rowGY+=Math.abs(r-pixels[up])+Math.abs(g-pixels[up+1])+Math.abs(b-pixels[up+2]);}const at=(y+1)*(w+1)+x+1,above=y*(w+1)+x+1;integral[at]=integral[above]+rowSum;gradX[at]=gradX[above]+rowGX;gradY[at]=gradY[above]+rowGY;}}
    const rectMean=(source,x0,y0,x1,y1,normalizer=1)=>{x0=clamp(Math.floor(x0),0,w);x1=clamp(Math.ceil(x1),0,w);y0=clamp(Math.floor(y0),0,h);y1=clamp(Math.ceil(y1),0,h);const total=source[y1*(w+1)+x1]-source[y0*(w+1)+x1]-source[y1*(w+1)+x0]+source[y0*(w+1)+x0];return total/Math.max(1,(x1-x0)*(y1-y0)*normalizer);};
    const mean=(cx,cy,radius)=>rectMean(integral,cx-radius,cy-radius,cx+radius,cy+radius);
    const wideLayout=image.naturalWidth/image.naturalHeight>1.9,cellMin=wideLayout?.056:.052,cellMax=wideLayout?.063:.061;
    const minCell=Math.max(12,Math.floor(w*cellMin)),maxCell=Math.min(Math.floor(w*cellMax),Math.floor(Math.min(w/cols,h/rows)*.9));
    let best={score:-Infinity,x:w*.43,y:h*.18,cell:Math.min(w/cols*.52,h/rows*.52)};
    const test=(x,y,cell)=>{let centers=0,edges=0;const radius=Math.max(2,cell*.16),strip=Math.max(1,cell*.035);for(let r=0;r<rows;r+=1)for(let c=0;c<cols;c+=1)centers+=mean(x+(c+.5)*cell,y+(r+.5)*cell,radius);for(let c=0;c<=cols;c+=1)edges+=rectMean(gradX,x+c*cell-strip,y,x+c*cell+strip,y+rows*cell,765);for(let r=0;r<=rows;r+=1)edges+=rectMean(gradY,x,y+r*cell-strip,x+cols*cell,y+r*cell+strip,765);return centers/(rows*cols)*2.7+edges/(cols+rows+2)*2.4+cell*.012;};
    for(let cell=minCell;cell<=maxCell;cell+=2){for(let y=Math.floor(h*.09);y<=h-rows*cell;y+=4){for(let x=Math.floor(w*.40);x<=w-cols*cell;x+=4){const score=test(x,y,cell);if(score>best.score)best={score,x,y,cell};}}}
    const rough=best;for(let cell=Math.max(minCell,rough.cell-3);cell<=Math.min(maxCell,rough.cell+3);cell+=1){for(let y=Math.max(0,rough.y-5);y<=Math.min(h-rows*cell,rough.y+5);y+=1){for(let x=Math.max(0,rough.x-5);x<=Math.min(w-cols*cell,rough.x+5);x+=1){const score=test(x,y,cell);if(score>best.score)best={score,x,y,cell};}}}
    return {x:best.x/scale,y:best.y/scale,w:cols*best.cell/scale,h:rows*best.cell/scale,confidence:best.score};
  }
  function autoCrop() {
    if (!recognition.image) return;
    const image = recognition.image;
    const rows = Number($("recognitionRows").value) || 5, cols = Number($("recognitionCols").value) || 9;
    const ratio = cols / rows;
    const wideShot = image.naturalWidth / image.naturalHeight > 1.7;
    let w = image.naturalWidth * (wideShot ? .528 : .9);
    let h = w / ratio;
    if (h > image.naturalHeight * .82) { h = image.naturalHeight * .82; w = h * ratio; }
    recognition.boardCrop = locateBoardFromPixels(image,rows,cols);
    recognition.inventoryCrop = wideShot && image.naturalWidth/image.naturalHeight>1.9 ? {
      x:image.naturalWidth*.005,y:image.naturalHeight*.755,w:image.naturalWidth*.355,h:image.naturalHeight*.235,
    } : {x:image.naturalWidth*.07,y:image.naturalHeight*.775,w:image.naturalWidth*.35,h:image.naturalHeight*.21};
    document.querySelectorAll(".zone-button").forEach((button) => button.classList.toggle("active", button.dataset.zone === recognition.activeZone));
    drawRecognitionCanvas();
  }
  function drawRecognitionCanvas() {
    const canvas = $("recognitionCanvas"), image = recognition.image;
    if (!image) return;
    const scale = Math.min(1, 900 / image.naturalWidth, 580 / image.naturalHeight);
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const boardCrop = recognition.boardCrop, inventoryCrop = recognition.inventoryCrop;
    if (!boardCrop || !inventoryCrop) return;
    const sx = canvas.width / image.naturalWidth, sy = canvas.height / image.naturalHeight;
    ctx.fillStyle = "rgba(9,18,35,.52)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    [boardCrop, inventoryCrop].forEach((crop) => { ctx.save(); ctx.beginPath(); ctx.rect(crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy); ctx.clip(); ctx.drawImage(image, 0, 0, canvas.width, canvas.height); ctx.restore(); });
    const drawBox=(crop,color,active)=>{const x=crop.x*sx,y=crop.y*sy,w=crop.w*sx,h=crop.h*sy;ctx.strokeStyle=color;ctx.lineWidth=active?4:2;ctx.strokeRect(x,y,w,h);if(active){const points=[[x,y],[x+w/2,y],[x+w,y],[x,y+h/2],[x+w,y+h/2],[x,y+h],[x+w/2,y+h],[x+w,y+h]];ctx.fillStyle="#fff";ctx.strokeStyle=color;ctx.lineWidth=2;points.forEach(([px,py])=>{ctx.fillRect(px-5,py-5,10,10);ctx.strokeRect(px-5,py-5,10,10);});}};
    drawBox(boardCrop,"#37a8ff",recognition.activeZone==="board");drawBox(inventoryCrop,"#f050a0",recognition.activeZone==="inventory");
    ctx.font = "bold 12px sans-serif"; ctx.fillStyle = "#fff";
    ctx.fillText("棋盘格子", boardCrop.x * sx + 7, boardCrop.y * sy + 17); ctx.fillText("剩余物体栏", inventoryCrop.x * sx + 7, inventoryCrop.y * sy + 17);
    const rows = Number($("recognitionRows").value) || 5, cols = Number($("recognitionCols").value) || 9;
    ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1;
    for (let c = 1; c < cols; c += 1) { const x = (boardCrop.x + boardCrop.w * c / cols) * sx; ctx.beginPath(); ctx.moveTo(x, boardCrop.y * sy); ctx.lineTo(x, (boardCrop.y + boardCrop.h) * sy); ctx.stroke(); }
    for (let r = 1; r < rows; r += 1) { const y = (boardCrop.y + boardCrop.h * r / rows) * sy; ctx.beginPath(); ctx.moveTo(boardCrop.x * sx, y); ctx.lineTo((boardCrop.x + boardCrop.w) * sx, y); ctx.stroke(); }
  }
  function analyzeRecognition() {
    const image = recognition.image, crop = recognition.boardCrop;
    if (!image || !crop) return;
    const rows = clamp(Number($("recognitionRows").value) || 5, 1, 10);
    const cols = clamp(Number($("recognitionCols").value) || 9, 1, 12);
    const sample = document.createElement("canvas"); sample.width = Math.max(180, cols * 32); sample.height = Math.max(100, rows * 32);
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, sample.width, sample.height);
    const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
    const detected = [], cellFeatures = [];
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
      const x0 = Math.floor((c + .22) * sample.width / cols), x1 = Math.ceil((c + .78) * sample.width / cols);
      const y0 = Math.floor((r + .22) * sample.height / rows), y1 = Math.ceil((r + .78) * sample.height / rows);
      let count = 0, saturated = 0, dark = 0, brightNeutral = 0, brightness = 0, brightnessSq = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * sample.width + x) * 4, red = pixels[i], green = pixels[i + 1], blue = pixels[i + 2];
        const max = Math.max(red, green, blue), min = Math.min(red, green, blue), light = (max + min) / 2;
        const sat = max === min ? 0 : (max - min) / (255 - Math.abs(2 * light - 255));
        const luminance=.2126 * red + .7152 * green + .0722 * blue; brightness += luminance; brightnessSq += luminance*luminance;
        if (sat > .28 && max - min > 35) saturated += 1;
        if (red + green + blue < 405) dark += 1;
        if (max > 190 && max - min < 45) brightNeutral += 1;
        count += 1;
      }
      const satRate = saturated / count, darkRate = dark / count, neutralRate = brightNeutral / count, mean = brightness / count, deviation=Math.sqrt(Math.max(0,brightnessSq/count-mean*mean));
      const objectTexture = deviation >= 16 && neutralRate >= .05;
      const plainColoredTile = satRate > .56 && deviation < 20 && !objectTexture;
      detected.push(plainColoredTile ? "unknown" : (darkRate > .18 || satRate > .38 || (neutralRate < .82 && deviation > 30) || mean < 145 ? "found" : "miss"));
      const wx0 = Math.floor((c + .08) * sample.width / cols), wx1 = Math.ceil((c + .92) * sample.width / cols);
      const wy0 = Math.floor((r + .08) * sample.height / rows), wy1 = Math.ceil((r + .92) * sample.height / rows);
      let wideCount = 0, wideSaturated = 0, wideNeutral = 0, wideBrightness = 0, wideBrightnessSq = 0;
      for (let y = wy0; y < wy1; y += 2) for (let x = wx0; x < wx1; x += 2) {
        const i = (y * sample.width + x) * 4, red = pixels[i], green = pixels[i + 1], blue = pixels[i + 2];
        const max = Math.max(red, green, blue), min = Math.min(red, green, blue), light = (max + min) / 2;
        const sat = max === min ? 0 : (max - min) / (255 - Math.abs(2 * light - 255));
        const luminance = .2126 * red + .7152 * green + .0722 * blue;
        wideBrightness += luminance; wideBrightnessSq += luminance * luminance;
        if (sat > .28 && max - min > 35) wideSaturated += 1;
        if (max > 190 && max - min < 45) wideNeutral += 1;
        wideCount += 1;
      }
      const wideMean = wideBrightness / wideCount;
      cellFeatures.push({
        wideSatRate: wideSaturated / wideCount,
        wideNeutralRate: wideNeutral / wideCount,
        wideDeviation: Math.sqrt(Math.max(0, wideBrightnessSq / wideCount - wideMean * wideMean)),
      });
    }
    const contextual = promoteTexturedRevealedCells(detected, cellFeatures, rows, cols);
    const completed = completeRectangularFoundRegions(contextual, rows, cols);
    recognition.cells = completed;
    recognition.rows = rows; recognition.cols = cols;
    const visualShapes = detectVisualShapes(pixels, sample.width, sample.height, rows, cols);
    recognition.shapes = mergeRecognizedShapes(visualShapes.length ? visualShapes : detectObjectShapes(completed, rows, cols));
    const inventoryCounts = detectInventoryCounts(image, recognition.inventoryCrop);
    if (inventoryCounts.length) {
      const detectedShapes=recognition.shapes.slice();
      recognition.shapes=inventoryCounts.map((count,index)=>{
        const known=state.shapes.length===inventoryCounts.length?state.shapes[index]:detectedShapes[index];
        return {w:known?.w|| (index===inventoryCounts.length-1?1:2),h:known?.h|| (index===inventoryCounts.length-1?1:2),count};
      });
    }
    const counts = completed.reduce((acc, value) => ((acc[value] = (acc[value] || 0) + 1), acc), {});
    const rowsHtml = recognition.shapes.length ? recognition.shapes.map((shape, index) => `<label class="recognized-shape-row"><b>物品 ${index+1} · ${shape.w} × ${shape.h}</b><span>剩余数量</span><input data-recognized-count="${index}" type="number" min="0" max="20" value="${shape.count}"></label>`).join("") : "<small>未识别到物品轮廓，请手动添加。</small>";
    const inventoryText = inventoryCounts.length ? `物品栏读数：${inventoryCounts.join(" / ")}` : "物品栏数字不清晰，请校对数量";
    $("recognitionResult").innerHTML = `<b>双区域识别完成</b><div class="result-counts"><span>待翻 ${counts.unknown || 0}</span><span>空格 ${counts.miss || 0}</span><span>物品 ${counts.found || 0} 格</span></div><div>${inventoryText}</div><div class="recognized-list">${rowsHtml}</div>`;
    $("recognitionResult").hidden = false;
    $("recognitionStatus").textContent = `已分析 ${rows * cols} 个格子，可应用后继续校正`;
    $("applyRecognitionButton").disabled = false;
  }
  function promoteTexturedRevealedCells(cells, features, rows, cols) {
    const promoted = cells.slice();
    cells.forEach((value, index) => {
      if (value !== "unknown") return;
      const feature = features[index], row = Math.floor(index / cols), col = index % cols;
      const texturedObject = feature.wideDeviation >= 24 && feature.wideNeutralRate >= .08 && feature.wideSatRate <= .94;
      if (!texturedObject) return;
      let touchesRevealed = false;
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue;
        const nr = row + dr, nc = col + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && cells[nr * cols + nc] !== "unknown") touchesRevealed = true;
      }
      if (touchesRevealed) promoted[index] = "found";
    });
    return promoted;
  }
  function completeRectangularFoundRegions(cells, rows, cols) {
    const completed = cells.slice(), candidates = [];
    for (let h = 2; h <= Math.min(3, rows); h += 1) for (let w = 2; w <= Math.min(4, cols); w += 1) {
      const area = w * h;
      if (area > 12) continue;
      for (let top = 0; top <= rows - h; top += 1) for (let left = 0; left <= cols - w; left += 1) {
        let found = 0, miss = 0, unknown = 0;
        const foundRows = new Set(), foundCols = new Set(), indices = [];
        for (let r = top; r < top + h; r += 1) for (let c = left; c < left + w; c += 1) {
          const index = r * cols + c, value = completed[index]; indices.push(index);
          if (value === "found") { found += 1; foundRows.add(r); foundCols.add(c); }
          else if (value === "miss") miss += 1;
          else unknown += 1;
        }
        const holes = area - found;
        if (unknown || miss !== holes || holes < 1 || holes > 2) continue;
        if (found < 3 || found / area < .6) continue;
        if (!foundRows.has(top) || !foundRows.has(top + h - 1) || !foundCols.has(left) || !foundCols.has(left + w - 1)) continue;
        candidates.push({ indices, holes, area, found });
      }
    }
    candidates.sort((a, b) => a.holes - b.holes || b.area - a.area || b.found - a.found);
    const claimed = new Set();
    candidates.forEach((candidate) => {
      const holes = candidate.indices.filter((index) => completed[index] === "miss");
      if (!holes.length || holes.length > candidate.holes || holes.some((index) => claimed.has(index))) return;
      holes.forEach((index) => { completed[index] = "found"; claimed.add(index); });
    });
    return completed;
  }
  function detectObjectShapes(cells, rows, cols) {
    const visited = new Set(), shapes = [];
    cells.forEach((value, start) => {
      if (value !== "found" || visited.has(start)) return;
      const queue = [start], component = []; visited.add(start);
      while (queue.length) {
        const index = queue.shift(); component.push(index);
        const r = Math.floor(index / cols), c = index % cols;
        [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].forEach(([nr,nc]) => {
          const next = nr * cols + nc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && cells[next] === "found" && !visited.has(next)) { visited.add(next); queue.push(next); }
        });
      }
      const rs = component.map((i) => Math.floor(i / cols)), cs = component.map((i) => i % cols);
      shapes.push({ w: Math.max(...cs) - Math.min(...cs) + 1, h: Math.max(...rs) - Math.min(...rs) + 1, count: 1 });
    });
    return shapes;
  }
  function detectVisualShapes(pixels, width, height, rows, cols) {
    const mask = new Uint8Array(width * height), visited = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i += 1) {
      const red = pixels[i * 4], green = pixels[i * 4 + 1], blue = pixels[i * 4 + 2];
      const max = Math.max(red, green, blue), min = Math.min(red, green, blue), light = (max + min) / 2;
      const sat = max === min ? 0 : (max - min) / (255 - Math.abs(2 * light - 255));
      const luminance = .2126 * red + .7152 * green + .0722 * blue;
      if (luminance < 166 && sat < .24) mask[i] = 1;
    }
    const cellW = width / cols, cellH = height / rows, minimumArea = cellW * cellH * .075;
    const candidates = [];
    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || visited[start]) continue;
      const queue = [start]; visited[start] = 1;
      let cursor = 0, area = 0, minX = width, maxX = 0, minY = height, maxY = 0;
      while (cursor < queue.length) {
        const index = queue[cursor++], x = index % width, y = Math.floor(index / width);
        area += 1; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy, next = ny * width + nx;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
        }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (area >= minimumArea && bw > cellW * .22 && bh > cellH * .22) {
        candidates.push({ w: clamp(Math.round(bw / cellW), 1, cols), h: clamp(Math.round(bh / cellH), 1, rows), count: 1, area });
      }
    }
    return candidates.sort((a, b) => b.area - a.area).slice(0, 8).map(({ w, h, count }) => ({ w, h, count }));
  }
  function mergeRecognizedShapes(shapes) {
    const merged = [];
    shapes.forEach((shape) => {
      const w = Math.max(shape.w, shape.h), h = Math.min(shape.w, shape.h);
      const match = merged.find((item) => item.w === w && item.h === h);
      if (match) match.count += shape.count || 1;
      else merged.push({ w, h, count: shape.count || 1 });
    });
    return merged.sort((a, b) => b.w * b.h - a.w * a.h);
  }
  function detectInventoryCounts(image, crop) {
    if (!image || !crop || crop.w < 20 || crop.h < 20) return [];
    const canvas = document.createElement("canvas"); canvas.width = 720; canvas.height = 240;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const slots = clamp(Math.round(crop.w / crop.h), 1, 6), slotW = canvas.width / slots, counts = [];
    const templates = {
      0:"11111100011000110001100011000111111", 1:"00100011000010000100001000010001110",
      2:"11110000010000111111100001000011111", 3:"11110000010000101110000010000111110",
      4:"10001100011000111111000010000100001", 5:"11111100001000011110000010000111110",
      6:"01111100001000011111100011000101110", 7:"11111000010001000100010000100010000",
      8:"01110100011000101110100011000101110", 9:"01110100011000101111000010000111110",
    };
    for (let slot = 0; slot < slots; slot += 1) {
      const x0 = Math.floor(slot * slotW + slotW * .62), x1 = Math.floor((slot + 1) * slotW - 2);
      const y0 = Math.floor(canvas.height * .48), y1 = canvas.height - 2;
      const components = [], seen = new Set();
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
        const key = y * canvas.width + x; if (seen.has(key)) continue;
        const p = key * 4, lum = .2126 * data[p] + .7152 * data[p+1] + .0722 * data[p+2];
        if (lum > 215) continue;
        const queue = [key]; seen.add(key); let cursor = 0, minX=x,maxX=x,minY=y,maxY=y,area=0;
        while (cursor < queue.length) {
          const current=queue[cursor++], cx=current%canvas.width, cy=Math.floor(current/canvas.width); area+=1;
          minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);
          [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>{ const nx=cx+dx,ny=cy+dy,nk=ny*canvas.width+nx;if(nx>=x0&&nx<x1&&ny>=y0&&ny<y1&&!seen.has(nk)){const q=nk*4, l=.2126*data[q]+.7152*data[q+1]+.0722*data[q+2];if(l<=215){seen.add(nk);queue.push(nk);}} });
        }
        const componentW=maxX-minX+1,componentH=maxY-minY+1;
        if (area > 20 && componentH > 12 && componentH < 68 && componentW < slotW*.30) components.push({minX,maxX,minY,maxY,area});
      }
      const digit = components.sort((a,b)=>b.maxX-a.maxX || b.area-a.area)[0];
      if (!digit) continue;
      let best = null, bestScore = Infinity;
      Object.entries(templates).forEach(([number, pattern]) => {
        let score = 0;
        for (let gy=0;gy<7;gy+=1) for(let gx=0;gx<5;gx+=1){
          const px=Math.round(digit.minX+(digit.maxX-digit.minX)*gx/4), py=Math.round(digit.minY+(digit.maxY-digit.minY)*gy/6), p=(py*canvas.width+px)*4;
          const ink=(.2126*data[p]+.7152*data[p+1]+.0722*data[p+2])<215 ? 1:0;
          if (ink !== Number(pattern[gy*5+gx])) score += 1;
        }
        if(score<bestScore){bestScore=score;best=Number(number);}
      });
      const aspect=(digit.maxX-digit.minX+1)/(digit.maxY-digit.minY+1);
      let lowerInk=0,lowerTotal=0;
      for(let y=Math.floor(digit.minY+(digit.maxY-digit.minY+1)*.72);y<=digit.maxY;y+=1)for(let x=digit.minX;x<=Math.floor(digit.minX+(digit.maxX-digit.minX+1)*.6);x+=1){const p=(y*canvas.width+x)*4;lowerInk+=(.2126*data[p]+.7152*data[p+1]+.0722*data[p+2])<215?1:0;lowerTotal+=1;}
      const lowerLeft=lowerInk/Math.max(1,lowerTotal),holes=countDigitHoles(data,canvas.width,digit,215);
      if (aspect < .5) best = 1;
      else if (holes > 0) best = lowerLeft < .42 ? 4 : 0;
      else if (lowerLeft > .42) best = 3;
      if (bestScore <= 19) counts.push(best);
    }
    return counts;
  }
  function countDigitHoles(data, width, digit, threshold=175) {
    const bw=digit.maxX-digit.minX+1,bh=digit.maxY-digit.minY+1, white=new Uint8Array(bw*bh),seen=new Uint8Array(bw*bh);
    for(let y=0;y<bh;y+=1) for(let x=0;x<bw;x+=1){const p=((digit.minY+y)*width+digit.minX+x)*4;white[y*bw+x]=(.2126*data[p]+.7152*data[p+1]+.0722*data[p+2])>=threshold?1:0;}
    let holes=0;
    for(let start=0;start<white.length;start+=1){if(!white[start]||seen[start])continue;const queue=[start];seen[start]=1;let cursor=0,touches=false;while(cursor<queue.length){const index=queue[cursor++],x=index%bw,y=Math.floor(index/bw);if(x===0||y===0||x===bw-1||y===bh-1)touches=true;[[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>{const nx=x+dx,ny=y+dy,next=ny*bw+nx;if(nx>=0&&nx<bw&&ny>=0&&ny<bh&&white[next]&&!seen[next]){seen[next]=1;queue.push(next);}});}if(!touches)holes+=1;}
    return holes;
  }
  function applyRecognition() {
    if (!recognition.cells) return;
    const before = snapshot();
    state.rows = recognition.rows; state.cols = recognition.cols; state.cells = recognition.cells.slice();
    if ($("syncShapes").checked) state.shapes = recognition.shapes.map((found, index) => ({
      id: uid(), w: found.w, h: found.h,
      count: Math.max(0, Number(document.querySelector(`[data-recognized-count="${index}"]`)?.value) || 0),
      rotate: found.w !== found.h,
    }));
    elements.rows.value = state.rows; elements.cols.value = state.cols;
    pushHistory(before); renderShapes(); renderBoard(); saveState(); solveNow(); closeImageDialog();
    toast("截图结果已应用，可用画笔继续校正");
  }

  function presetIndices() {
    const a = presetSelection.start, b = presetSelection.end;
    const ar=Math.floor(a/5),ac=a%5,br=Math.floor(b/5),bc=b%5, result=[];
    for(let r=Math.min(ar,br);r<=Math.max(ar,br);r+=1) for(let c=Math.min(ac,bc);c<=Math.max(ac,bc);c+=1) result.push(r*5+c);
    return result;
  }
  function renderPresetGrid() {
    const selected = presetIndices(), grid = $("presetGrid"); grid.innerHTML = "";
    for (let index=0; index<25; index+=1) { const cell=document.createElement("button"); cell.type="button"; cell.className=`preset-cell${selected.includes(index)?" selected":""}`; cell.dataset.index=index; cell.setAttribute("aria-label",`预设格 ${index+1}`); grid.appendChild(cell); }
    const rs=selected.map(i=>Math.floor(i/5)),cs=selected.map(i=>i%5);
    $("presetSize").textContent=`${Math.max(...cs)-Math.min(...cs)+1} × ${Math.max(...rs)-Math.min(...rs)+1}`;
  }
  function confirmPresetShape() {
    const selected=presetIndices(), rs=selected.map(i=>Math.floor(i/5)),cs=selected.map(i=>i%5);
    const w=Math.max(...cs)-Math.min(...cs)+1,h=Math.max(...rs)-Math.min(...rs)+1,before=snapshot();
    const match=state.shapes.find(shape=>(shape.w===w&&shape.h===h)||(shape.rotate&&shape.w===h&&shape.h===w));
    if(match) match.count+=1; else state.shapes.push({id:uid(),w,h,count:1,rotate:w!==h});
    pushHistory(before); renderShapes(); saveState(); scheduleSolve(); $("presetShapePanel").hidden=true; toast(`已预设 ${w}×${h} 物品`);
  }

  document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll(".mode-button").forEach((item) => item.classList.toggle("active", item === button));
    saveState();
  }));
  document.querySelectorAll(".tool-button").forEach((button) => button.addEventListener("click", () => {
    inputTool = button.dataset.tool;
    document.querySelectorAll(".tool-button").forEach((item) => item.classList.toggle("active", item === button));
    const messages = {
      paint: "按住鼠标或手指划过格子，连续录入当前状态。",
      box: "从起点拖到终点，松开后把矩形区域设为当前状态。",
      object: "拖出物品占用的矩形；系统会自动新增尺寸或将同尺寸数量 +1。",
    };
    $("toolHelper").textContent = messages[inputTool];
  }));
  elements.board.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest(".cell"); if (!cell || event.button > 0) return;
    event.preventDefault(); beginGesture(Number(cell.dataset.index), event.pointerId);
  });
  elements.board.addEventListener("pointermove", (event) => {
    if (!gesture) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest(".cell");
    if (cell && elements.board.contains(cell)) moveGesture(Number(cell.dataset.index));
  });
  elements.board.addEventListener("pointerup", finishGesture);
  elements.board.addEventListener("pointercancel", finishGesture);
  $("undoButton").addEventListener("click", undo);
  $("redoButton").addEventListener("click", redo);
  $("addShapeButton").addEventListener("click", () => {
    const before = snapshot();
    state.shapes.push({ id: uid(), w: 2, h: 2, count: 1, rotate: true });
    pushHistory(before); renderShapes(); saveState(); scheduleSolve();
  });
  $("presetShapeButton").addEventListener("click", () => { $("presetShapePanel").hidden=false; presetSelection={start:0,end:0,dragging:false}; renderPresetGrid(); });
  $("cancelPresetButton").addEventListener("click", () => { $("presetShapePanel").hidden=true; });
  $("confirmPresetButton").addEventListener("click", confirmPresetShape);
  $("presetGrid").addEventListener("pointerdown", event => { const cell=event.target.closest(".preset-cell");if(!cell)return;event.preventDefault();presetSelection.start=Number(cell.dataset.index);presetSelection.end=presetSelection.start;presetSelection.dragging=true;$("presetGrid").setPointerCapture?.(event.pointerId);renderPresetGrid(); });
  $("presetGrid").addEventListener("pointermove", event => { if(!presetSelection.dragging)return;const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest(".preset-cell");if(cell&&$("presetGrid").contains(cell)){presetSelection.end=Number(cell.dataset.index);renderPresetGrid();} });
  $("presetGrid").addEventListener("pointerup", () => { presetSelection.dragging=false; });
  $("applySizeButton").addEventListener("click", applySize);
  $("resetButton").addEventListener("click", () => {
    const before = snapshot();
    state = defaultState(); result = null;
    elements.rows.value = state.rows; elements.cols.value = state.cols;
    document.querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
    pushHistory(before); renderShapes(); renderBoard(); saveState(); solveNow();
  });
  elements.metric.addEventListener("change", renderBoard);
  elements.solve.addEventListener("click", solveNow);

  $("imageButton").addEventListener("click", openImageDialog);
  document.querySelectorAll(".wallpaper-preset").forEach((button) => button.addEventListener("click", () => {
    appearance = { ...appearance, wallpaper: button.dataset.wallpaper };
    applyAppearance(); saveAppearance();
  }));
  $("wallpaperFileInput").addEventListener("change", (event) => useWallpaperFile(event.target.files[0]));
  [["wallpaperBlur", "blur"], ["wallpaperDim", "dim"], ["panelOpacity", "panel"], ["controlTransparency", "controlTransparency"]].forEach(([id, key]) => {
    $(id).addEventListener("input", (event) => { appearance[key] = Number(event.target.value); applyAppearance(); });
    $(id).addEventListener("change", saveAppearance);
  });
  $("foundSkinToggle").addEventListener("click", () => {
    appearance.foundStyle = appearance.foundStyle === "xiaotao" ? "dark" : "xiaotao";
    applyAppearance(); saveAppearance();
  });
  $("resetAppearanceButton").addEventListener("click", () => { appearance = defaultAppearance(); applyAppearance(); saveAppearance(); toast("界面设置已恢复默认"); });
  $("closeImageButton").addEventListener("click", closeImageDialog);
  $("imageDialog").addEventListener("click", (event) => { if (event.target === $("imageDialog")) closeImageDialog(); });
  $("imageFileInput").addEventListener("change", (event) => loadRecognitionFile(event.target.files[0]));
  $("imageDropzone").addEventListener("dragover", (event) => { event.preventDefault(); $("imageDropzone").classList.add("dragover"); });
  $("imageDropzone").addEventListener("dragleave", () => $("imageDropzone").classList.remove("dragover"));
  $("imageDropzone").addEventListener("drop", (event) => { event.preventDefault(); $("imageDropzone").classList.remove("dragover"); loadRecognitionFile(event.dataTransfer.files[0]); });
  window.addEventListener("paste", (event) => {
    const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith("image/"));
    if (item) { event.preventDefault(); openImageDialog(); loadRecognitionFile(item.getAsFile()); }
  });
  $("autoCropButton").addEventListener("click", autoCrop);
  $("analyzeButton").addEventListener("click", analyzeRecognition);
  $("applyRecognitionButton").addEventListener("click", applyRecognition);
  [$("recognitionRows"), $("recognitionCols")].forEach((input) => input.addEventListener("change", () => { autoCrop(); $("applyRecognitionButton").disabled = true; }));
  let cropDrag = null;
  document.querySelectorAll(".zone-button").forEach(button=>button.addEventListener("click",()=>{recognition.activeZone=button.dataset.zone;document.querySelectorAll(".zone-button").forEach(item=>item.classList.toggle("active",item===button));drawRecognitionCanvas();}));
  function cropHitTest(point, canvas) {
    const crop=recognition.activeZone==="board"?recognition.boardCrop:recognition.inventoryCrop;if(!crop)return "draw";
    const sx=canvas.width/recognition.image.naturalWidth,sy=canvas.height/recognition.image.naturalHeight,x=crop.x*sx,y=crop.y*sy,w=crop.w*sx,h=crop.h*sy,t=10;
    const near=(px,py)=>Math.abs(point.x-px)<=t&&Math.abs(point.y-py)<=t;
    if(near(x,y))return "nw";if(near(x+w,y))return "ne";if(near(x,y+h))return "sw";if(near(x+w,y+h))return "se";
    if(near(x+w/2,y))return "n";if(near(x+w/2,y+h))return "s";if(near(x,y+h/2))return "w";if(near(x+w,y+h/2))return "e";
    if(point.x>x&&point.x<x+w&&point.y>y&&point.y<y+h)return "move";return "draw";
  }
  $("recognitionCanvas").addEventListener("pointerdown", (event) => { if (!recognition.image) return;const point=canvasPoint(event),crop=recognition.activeZone==="board"?recognition.boardCrop:recognition.inventoryCrop;cropDrag={start:point,mode:cropHitTest(point,event.currentTarget),initial:crop?{...crop}:null};event.currentTarget.setPointerCapture(event.pointerId); });
  $("recognitionCanvas").addEventListener("pointermove", (event) => {
    if (!recognition.image) return;
    const point = canvasPoint(event), canvas = event.currentTarget;
    if(!cropDrag){const mode=cropHitTest(point,canvas),cursors={move:"move",n:"ns-resize",s:"ns-resize",e:"ew-resize",w:"ew-resize",nw:"nwse-resize",se:"nwse-resize",ne:"nesw-resize",sw:"nesw-resize",draw:"crosshair"};canvas.style.cursor=cursors[mode];return;}
    const sx = recognition.image.naturalWidth / canvas.width, sy = recognition.image.naturalHeight / canvas.height;
    const start={x:cropDrag.start.x*sx,y:cropDrag.start.y*sy},current={x:point.x*sx,y:point.y*sy},dx=current.x-start.x,dy=current.y-start.y,initial=cropDrag.initial;
    let nextCrop;
    if(cropDrag.mode==="draw"||!initial)nextCrop={x:Math.min(start.x,current.x),y:Math.min(start.y,current.y),w:Math.abs(current.x-start.x),h:Math.abs(current.y-start.y)};
    else if(cropDrag.mode==="move")nextCrop={...initial,x:initial.x+dx,y:initial.y+dy};
    else{let left=initial.x,top=initial.y,right=initial.x+initial.w,bottom=initial.y+initial.h;if(cropDrag.mode.includes("w"))left+=dx;if(cropDrag.mode.includes("e"))right+=dx;if(cropDrag.mode.includes("n"))top+=dy;if(cropDrag.mode.includes("s"))bottom+=dy;nextCrop={x:Math.min(left,right),y:Math.min(top,bottom),w:Math.abs(right-left),h:Math.abs(bottom-top)};}
    nextCrop.w=Math.max(24,nextCrop.w);nextCrop.h=Math.max(20,nextCrop.h);nextCrop.x=clamp(nextCrop.x,0,recognition.image.naturalWidth-nextCrop.w);nextCrop.y=clamp(nextCrop.y,0,recognition.image.naturalHeight-nextCrop.h);
    if (recognition.activeZone === "board") recognition.boardCrop = nextCrop; else recognition.inventoryCrop = nextCrop;
    drawRecognitionCanvas();
  });
  $("recognitionCanvas").addEventListener("pointerup", () => { cropDrag = null; $("applyRecognitionButton").disabled = true; });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("imageDialog").hidden) closeImageDialog();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  });

  elements.rows.value = state.rows;
  elements.cols.value = state.cols;
  applyAppearance();
  document.querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  renderShapes(); renderBoard(); solveNow();
  updateHistoryButtons();
})();
