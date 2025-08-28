// Front‑end logic for the Image Overlay Web App.
// This script implements an interactive canvas where a user can load a
// background and an overlay image (with a grey matte), drag the overlay
// around, resize it, rotate it, flip it horizontally or vertically and
// export two images: the composited canvas and the keyed overlay only.

/* Global state */
let bgImg = null;              // HTMLImageElement for background
let overlayImg = null;         // HTMLImageElement for keyed overlay
let overlayOriginalImg = null; // Original keyed overlay (untransformed)
let overlayState = {
  x: 0,
  y: 0,
  scale: 1,
  angle: 0,   // degrees
  flipH: false,
  flipV: false,
};
let dragging = false;
let dragData = { localX: 0, localY: 0 };
// When true, the user is resizing the overlay via a corner handle
let resizing = false;
// Index of the handle being dragged (0: top‑left, 1: top‑right, 2: bottom‑right, 3: bottom‑left)
let resizeHandle = -1;
let saveCounter = 0;

// Canvas and context
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// UI elements
const bgInput = document.getElementById('bg-input');
const overlayInput = document.getElementById('overlay-input');
const removeOverlayBtn = document.getElementById('remove-overlay');
const setOutputBtn = document.getElementById('set-output');
const controls = document.getElementById('controls');
const smallerBtn = document.getElementById('smaller');
const biggerBtn = document.getElementById('bigger');
const angleInput = document.getElementById('angle-input');
const rotM5Btn = document.getElementById('rot-m5');
const rotP5Btn = document.getElementById('rot-p5');
const rotResetBtn = document.getElementById('rot-reset');
const flipHBtn = document.getElementById('flip-h');
const flipVBtn = document.getElementById('flip-v');
const outputPrefixInput = document.getElementById('output-prefix');
const saveBtn = document.getElementById('save');
const newBtn = document.getElementById('new-session');
const outputStatus = document.getElementById('output-status');
// Crop button and cropping state variables
const cropBtn = document.getElementById('crop');
// Indicates whether user has toggled crop mode
let cropMode = false;
// True while pointer drag defines the crop rectangle
let cropping = false;
// Starting corner of crop rectangle in unscaled overlay local coordinates
let cropStart = null;
// Ending corner of crop rectangle in unscaled overlay local coordinates
let cropEnd = null;

// Erase button and erasing state variables
const eraseBtn = document.getElementById('erase');
// Toggle for erase mode
let eraseMode = false;
// True while the user is selecting an erase region on the background
let erasing = false;
// Start and end points of the erase rectangle in canvas coordinates
let eraseStart = null;
let eraseEnd = null;

// Undo/Redo state and buttons. We maintain a stack of previous states
// (undoStack) and a stack of undone states (redoStack). Each state stores
// the overlay image data URL, the original keyed overlay data URL and the
// overlayState parameters. This allows reverting and re‑applying edits such as
// moves, resizes, rotations, flips and cropping.
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const undoStack = [];
const redoStack = [];

// Save the current overlay state onto the undo stack and clear the redo
// stack. Only saves when an overlay exists. Called at the beginning of
// interactive actions (dragging, resizing, rotating, flipping, cropping).
function saveState() {
  // Only record a state when a background image exists
  if (!bgImg) return;
  const stateCopy = { ...overlayState };
  // Store overlay and original images if present, otherwise null
  const overlayData = overlayImg ? overlayImg.src : null;
  const originalData = overlayOriginalImg ? overlayOriginalImg.src : null;
  const bgData = bgImg ? bgImg.src : null;
  undoStack.push({ overlayData, originalData, bgData, state: stateCopy });
  // Whenever we push a new state, clear the redo history
  redoStack.length = 0;
  updateUndoRedoButtons();
}

// Restore the most recent state from the undo stack. The current state is
// pushed onto the redo stack before restoring. If no undo is available the
// function does nothing.
function undo() {
  if (undoStack.length === 0) return;
  // Push the current state onto the redo stack, capturing overlay and background data
  const current = {
    overlayData: overlayImg ? overlayImg.src : null,
    originalData: overlayOriginalImg ? overlayOriginalImg.src : null,
    bgData: bgImg ? bgImg.src : null,
    state: { ...overlayState },
  };
  redoStack.push(current);
  const prev = undoStack.pop();
  // Restore previous overlay
  if (prev && prev.overlayData) {
    const img = new Image();
    img.onload = () => {
      overlayImg = img;
      overlayOriginalImg = img;
      overlayState = { ...prev.state };
      // After overlay loads, restore background if available
      if (prev.bgData) {
        const bimg = new Image();
        bimg.onload = () => {
          bgImg = bimg;
          drawScene();
          updateUndoRedoButtons();
        };
        bimg.src = prev.bgData;
      } else {
        drawScene();
        updateUndoRedoButtons();
      }
    };
    img.src = prev.overlayData;
  } else {
    // Remove overlay if none recorded
    overlayImg = null;
    overlayOriginalImg = null;
    // Restore background if available
    if (prev && prev.bgData) {
      const bimg = new Image();
      bimg.onload = () => {
        bgImg = bimg;
        drawScene();
        updateUndoRedoButtons();
      };
      bimg.src = prev.bgData;
    } else {
      drawScene();
      updateUndoRedoButtons();
    }
  }
}

// Reapply the most recently undone state from the redo stack. The current
// state is pushed back to the undo stack before restoring. If no redo is
// available the function does nothing.
function redo() {
  if (redoStack.length === 0) return;
  // Push the current state onto the undo stack
  const current = {
    overlayData: overlayImg ? overlayImg.src : null,
    originalData: overlayOriginalImg ? overlayOriginalImg.src : null,
    bgData: bgImg ? bgImg.src : null,
    state: { ...overlayState },
  };
  undoStack.push(current);
  const next = redoStack.pop();
  if (!next) return;
  // Restore overlay
  if (next.overlayData) {
    const img = new Image();
    img.onload = () => {
      overlayImg = img;
      overlayOriginalImg = img;
      overlayState = { ...next.state };
      // After overlay loads, restore background if available
      if (next.bgData) {
        const bimg = new Image();
        bimg.onload = () => {
          bgImg = bimg;
          drawScene();
          updateUndoRedoButtons();
        };
        bimg.src = next.bgData;
      } else {
        drawScene();
        updateUndoRedoButtons();
      }
    };
    img.src = next.overlayData;
  } else {
    // No overlay; clear
    overlayImg = null;
    overlayOriginalImg = null;
    // Restore background if available
    if (next.bgData) {
      const bimg = new Image();
      bimg.onload = () => {
        bgImg = bimg;
        drawScene();
        updateUndoRedoButtons();
      };
      bimg.src = next.bgData;
    } else {
      drawScene();
      updateUndoRedoButtons();
    }
  }
}

// Enable or disable undo and redo buttons based on stack sizes.
function updateUndoRedoButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

// Attach click handlers for undo/redo buttons
undoBtn.addEventListener('click', () => {
  undo();
});
redoBtn.addEventListener('click', () => {
  redo();
});

// Keyboard shortcuts: Ctrl/Cmd+Z for undo, Ctrl+Y or Ctrl+Shift+Z for redo
document.addEventListener('keydown', (e) => {
  const isCtrlOrMeta = e.ctrlKey || e.metaKey;
  if (!isCtrlOrMeta) return;
  // Undo: Ctrl/Cmd+Z (no Shift)
  if (e.code === 'KeyZ' && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  // Redo: Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z
  if ((e.code === 'KeyY') || (e.code === 'KeyZ' && e.shiftKey)) {
    e.preventDefault();
    redo();
  }
});

// Crop button toggles crop mode on and off. When entering crop mode the user can drag
// a rectangle on the overlay to crop the image. Clicking again cancels crop mode.
cropBtn.addEventListener('click', () => {
  // Crop button only works when an overlay image is loaded
  if (!overlayImg) return;
  if (!cropMode) {
    // Save current state before entering crop mode for undo
    saveState();
    // Enter crop mode: reset any previous selection
    cropMode = true;
    cropping = false;
    cropStart = null;
    cropEnd = null;
    cropBtn.textContent = 'Cancel Crop';
  } else {
    // Exit crop mode without applying crop
    cropMode = false;
    cropping = false;
    cropStart = null;
    cropEnd = null;
    cropBtn.textContent = 'Crop';
    drawScene();
  }
});

// Erase button toggles erase mode on and off. When erase mode is active the user
// can draw a rectangle on the background to generatively remove that region via the Bria API.
eraseBtn.addEventListener('click', () => {
  if (!bgImg) return;
  if (!eraseMode) {
    // Save state before entering erase mode for undo
    saveState();
    eraseMode = true;
    erasing = false;
    eraseStart = null;
    eraseEnd = null;
    eraseBtn.textContent = 'Cancel Erase';
  } else {
    // Cancel erase mode without applying erase
    eraseMode = false;
    erasing = false;
    eraseStart = null;
    eraseEnd = null;
    eraseBtn.textContent = 'Erase';
    drawScene();
  }
});

// Handle to a user‑selected output directory (via File System Access API)
let outputDirHandle = null;

// Helper: draw the current scene onto the canvas
function drawScene() {
  if (!bgImg) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  // Resize canvas to background image size
  canvas.width = bgImg.width;
  canvas.height = bgImg.height;
  // Draw background
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bgImg, 0, 0);
  // Draw overlay if present
  if (overlayImg) {
    const w = overlayImg.width * overlayState.scale;
    const h = overlayImg.height * overlayState.scale;
    const cx = overlayState.x + w / 2;
    const cy = overlayState.y + h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((overlayState.angle * Math.PI) / 180);
    // Flip via scaling negative axes
    const sx = overlayState.flipH ? -1 : 1;
    const sy = overlayState.flipV ? -1 : 1;
    ctx.scale(sx, sy);
    ctx.scale(overlayState.scale, overlayState.scale);
    ctx.drawImage(
      overlayImg,
      -overlayImg.width / 2,
      -overlayImg.height / 2
    );
    ctx.restore();

    // Draw bounding box and resize handles for interactive resizing
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((overlayState.angle * Math.PI) / 180);
    // Outline
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    // Draw handles as small squares (constant size in screen pixels). We don't scale these with overlay scale.
    const handleSize = 8;
    const halfHandle = handleSize / 2;
    const corners = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 }
    ];
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1;
    for (const c of corners) {
      // Draw handle rectangle
      ctx.beginPath();
      ctx.rect(c.x - halfHandle, c.y - halfHandle, handleSize, handleSize);
      ctx.fill();
      ctx.stroke();
    }
    // If cropping is active or in progress, draw the selection rectangle
    if ((cropMode || cropping) && cropStart && cropEnd) {
      // Determine rectangle in local unscaled coordinates
      let sx = Math.min(cropStart.x, cropEnd.x);
      let ex = Math.max(cropStart.x, cropEnd.x);
      let sy = Math.min(cropStart.y, cropEnd.y);
      let ey = Math.max(cropStart.y, cropEnd.y);
      // Apply flips for display
      const dispX1 = (overlayState.flipH ? -ex : sx) * overlayState.scale;
      const dispX2 = (overlayState.flipH ? -sx : ex) * overlayState.scale;
      const dispY1 = (overlayState.flipV ? -ey : sy) * overlayState.scale;
      const dispY2 = (overlayState.flipV ? -sy : ey) * overlayState.scale;
      const rectX = dispX1;
      const rectY = dispY1;
      const rectW = dispX2 - dispX1;
      const rectH = dispY2 - dispY1;
      ctx.save();
      // Fill cropping rectangle with semi‑transparent white to highlight the selected area
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(rectX, rectY, rectW, rectH);
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(rectX, rectY, rectW, rectH);
      ctx.setLineDash([]);
      ctx.restore();
    }
    ctx.restore();
  }
  // Draw the erase selection rectangle on the background when erasing
  if ((eraseMode || erasing) && eraseStart && eraseEnd) {
    const x1 = Math.min(eraseStart.x, eraseEnd.x);
    const y1 = Math.min(eraseStart.y, eraseEnd.y);
    const x2 = Math.max(eraseStart.x, eraseEnd.x);
    const y2 = Math.max(eraseStart.y, eraseEnd.y);
    ctx.save();
    // Semi-transparent fill to indicate selected region
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = 'rgba(0, 0, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// Helper: apply grey key to an Image to produce an RGBA image
function applyGreyKey(img, callback) {
  // Create a temporary canvas to read pixel data
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = img.width;
  tmpCanvas.height = img.height;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.drawImage(img, 0, 0);
  const imageData = tmpCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);
  const data = imageData.data;
  const keyR = 128;
  const keyG = 128;
  const keyB = 128;
  const tol = 22;
  const ramp = tol < 254 ? 2 : 1;
  // Precompute ramp lookup table for performance
  const lut = new Uint8ClampedArray(256);
  for (let d = 0; d < 256; d++) {
    let a;
    if (d <= tol) {
      a = 0;
    } else if (d >= tol + ramp) {
      a = 255;
    } else {
      a = Math.round((255 * (d - tol)) / ramp);
    }
    lut[d] = a;
  }
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const dr = Math.abs(r - keyR);
    const dg = Math.abs(g - keyG);
    const db = Math.abs(b - keyB);
    const maxDiff = Math.max(dr, Math.max(dg, db));
    data[i + 3] = lut[maxDiff];
  }
  tmpCtx.putImageData(imageData, 0, 0);
  const rgbaImg = new Image();
  rgbaImg.onload = () => callback(rgbaImg);
  rgbaImg.src = tmpCanvas.toDataURL();
}

// Event: load background
bgInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    bgImg = img;
    // Reset save counter
    saveCounter = 0;
    drawScene();
    // If overlay exists but is larger than new background, resize overlay
    if (overlayImg) {
      // Fit overlay within background bounds
      const maxW = bgImg.width;
      const maxH = bgImg.height;
      const ovW = overlayImg.width;
      const ovH = overlayImg.height;
      const scaleX = maxW / ovW;
      const scaleY = maxH / ovH;
      const maxScale = Math.min(scaleX, scaleY, 1);
      overlayState.scale = maxScale;
      // Clamp overlay position
      overlayState.x = Math.min(overlayState.x, bgImg.width - ovW * overlayState.scale);
      overlayState.y = Math.min(overlayState.y, bgImg.height - ovH * overlayState.scale);
    }
    controls.style.display = 'flex';
    saveBtn.disabled = !overlayImg;
    setOutputBtn.disabled = false;
    // Enable erase functionality now that a background is loaded
    eraseBtn.disabled = false;
  };
  img.src = URL.createObjectURL(file);
});

// Event: load overlay
overlayInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file || !bgImg) return;
  const rawImg = new Image();
  rawImg.onload = () => {
    // Apply grey key to convert to RGBA with transparency
    applyGreyKey(rawImg, (rgbaImg) => {
      overlayImg = rgbaImg;
      overlayOriginalImg = rgbaImg; // Save untransformed for overlay-only output
      // Compute initial scale: fit overlay into background if larger
      const maxW = bgImg.width;
      const maxH = bgImg.height;
      const ovW = overlayImg.width;
      const ovH = overlayImg.height;
      const scaleX = maxW / ovW;
      const scaleY = maxH / ovH;
      const maxScale = Math.min(scaleX, scaleY, 1);
      overlayState.scale = maxScale;
      overlayState.angle = 0;
      overlayState.flipH = false;
      overlayState.flipV = false;
      // Place overlay near top-left with small margin
      overlayState.x = Math.min(20, maxW - ovW * overlayState.scale);
      overlayState.y = Math.min(20, maxH - ovH * overlayState.scale);
      saveBtn.disabled = false;
      removeOverlayBtn.disabled = false;
      angleInput.value = 0;
      // Enable crop functionality now that an overlay is loaded
      cropBtn.disabled = false;
      // Reset cropping state and button label
      cropMode = false;
      cropping = false;
      cropStart = null;
      cropEnd = null;
      cropBtn.textContent = 'Crop';
      drawScene();
      // Reset undo/redo stacks and save the initial state for undo
      undoStack.length = 0;
      redoStack.length = 0;
      saveState();
    });
  };
  rawImg.src = URL.createObjectURL(file);
});

// Remove overlay
removeOverlayBtn.addEventListener('click', () => {
  overlayImg = null;
  overlayOriginalImg = null;
  saveBtn.disabled = true;
  removeOverlayBtn.disabled = true;
  // Disable crop functionality when overlay is removed
  cropBtn.disabled = true;
  cropMode = false;
  cropping = false;
  cropStart = null;
  cropEnd = null;
  cropBtn.textContent = 'Crop';
  drawScene();
  // Clear undo/redo stacks when overlay is removed
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoRedoButtons();
});

// Set output directory using File System Access API
setOutputBtn.addEventListener('click', async () => {
  try {
    // Prompt user to select a directory. Requires secure context (https) in most browsers.
    const dirHandle = await window.showDirectoryPicker();
    outputDirHandle = dirHandle;
    outputStatus.textContent = `Output: ${dirHandle.name || 'selected'}`;
  } catch (err) {
    // User cancelled or API unavailable
    console.error('Directory selection cancelled or not supported', err);
  }
});

// New session: clear everything
newBtn.addEventListener('click', () => {
  bgImg = null;
  overlayImg = null;
  overlayOriginalImg = null;
  overlayState = { x: 0, y: 0, scale: 1, angle: 0, flipH: false, flipV: false };
  dragData = { localX: 0, localY: 0 };
  saveCounter = 0;
  removeOverlayBtn.disabled = true;
  saveBtn.disabled = true;
  angleInput.value = 0;
  controls.style.display = 'none';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  setOutputBtn.disabled = true;
  outputDirHandle = null;
  outputStatus.textContent = '';
  // Reset crop state and disable crop button
  cropBtn.disabled = true;
  cropMode = false;
  cropping = false;
  cropStart = null;
  cropEnd = null;
  cropBtn.textContent = 'Crop';
  // Reset erase state and disable erase button
  eraseBtn.disabled = true;
  eraseMode = false;
  erasing = false;
  eraseStart = null;
  eraseEnd = null;
  eraseBtn.textContent = 'Erase';
  // Clear undo/redo stacks on new session
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoRedoButtons();
});

// Resize overlay
smallerBtn.addEventListener('click', () => {
  if (!overlayImg) return;
  // Save state before scaling for undo
  saveState();
  const factor = 1 / 1.10;
  overlayState.scale *= factor;
  // Ensure overlay stays within bounds
  const w = overlayImg.width * Math.abs(overlayState.scale);
  const h = overlayImg.height * Math.abs(overlayState.scale);
  if (bgImg) {
    overlayState.x = Math.min(overlayState.x, bgImg.width - w);
    overlayState.y = Math.min(overlayState.y, bgImg.height - h);
  }
  drawScene();
});
biggerBtn.addEventListener('click', () => {
  if (!overlayImg) return;
  // Save state before scaling for undo
  saveState();
  const factor = 1.10;
  // Prevent overlay from exceeding background size
  const nextScale = overlayState.scale * factor;
  const w = overlayImg.width * Math.abs(nextScale);
  const h = overlayImg.height * Math.abs(nextScale);
  if (bgImg && (w > bgImg.width || h > bgImg.height)) return;
  overlayState.scale = nextScale;
  drawScene();
});

// Angle input
angleInput.addEventListener('input', (e) => {
  // Save state before changing angle via input
  saveState();
  const val = parseFloat(e.target.value) || 0;
  let angle = val;
  if (angle > 180) angle -= 360;
  if (angle < -180) angle += 360;
  overlayState.angle = angle;
  drawScene();
});

// Rotation buttons
rotM5Btn.addEventListener('click', () => {
  // Save state before rotating for undo
  saveState();
  overlayState.angle = normalizeAngle(overlayState.angle - 5);
  angleInput.value = Math.round(overlayState.angle);
  drawScene();
});
rotP5Btn.addEventListener('click', () => {
  // Save state before rotating for undo
  saveState();
  overlayState.angle = normalizeAngle(overlayState.angle + 5);
  angleInput.value = Math.round(overlayState.angle);
  drawScene();
});
rotResetBtn.addEventListener('click', () => {
  // Save state before resetting rotation for undo
  saveState();
  overlayState.angle = 0;
  angleInput.value = 0;
  drawScene();
});

// Flip buttons
flipHBtn.addEventListener('click', () => {
  // Save state before flipping horizontally for undo
  saveState();
  overlayState.flipH = !overlayState.flipH;
  drawScene();
});
flipVBtn.addEventListener('click', () => {
  // Save state before flipping vertically for undo
  saveState();
  overlayState.flipV = !overlayState.flipV;
  drawScene();
});

// Normalize angle to [-180, 180]
function normalizeAngle(angle) {
  let a = angle;
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

// Canvas pointer events for dragging
canvas.addEventListener('pointerdown', (e) => {
  // Require a background image to interact
  if (!bgImg) return;
  // Record state for undo at the beginning of an interaction
  saveState();
  // Compute pointer coordinates relative to canvas
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
  // If erase mode is active, begin selecting erase region
  if (eraseMode) {
    erasing = true;
    eraseStart = { x, y };
    eraseEnd = { x, y };
    canvas.setPointerCapture(e.pointerId);
    drawScene();
    e.preventDefault();
    return;
  }
  // If no overlay is loaded, nothing else to do
  if (!overlayImg) return;
  // Compute overlay dimensions in scaled units
  const w = overlayImg.width * Math.abs(overlayState.scale);
  const h = overlayImg.height * Math.abs(overlayState.scale);
  const cx = overlayState.x + w / 2;
  const cy = overlayState.y + h / 2;
  // Translate pointer into overlay local space (scaled)
  const dx = x - cx;
  const dy = y - cy;
  const angleRad = (-overlayState.angle * Math.PI) / 180;
  const localX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
  const localY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
  // If crop mode is active, begin cropping when clicking inside overlay
  if (cropMode) {
    const unscaledX = localX / overlayState.scale;
    const unscaledY = localY / overlayState.scale;
    if (Math.abs(unscaledX) <= overlayOriginalImg.width / 2 && Math.abs(unscaledY) <= overlayOriginalImg.height / 2) {
      cropping = true;
      cropStart = { x: unscaledX, y: unscaledY };
      cropEnd = { x: unscaledX, y: unscaledY };
      canvas.setPointerCapture(e.pointerId);
      drawScene();
      e.preventDefault();
      return;
    } else {
      // Clicked outside overlay: cancel crop mode
      cropMode = false;
      cropping = false;
      cropStart = null;
      cropEnd = null;
      cropBtn.textContent = 'Crop';
      drawScene();
      return;
    }
  }
  // Check for resize handle interactions
  if (overlayImg) {
    const handleSize = 10;
    const corners = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ];
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      if (Math.abs(localX - c.x) <= handleSize && Math.abs(localY - c.y) <= handleSize) {
        resizing = true;
        resizeHandle = i;
        dragging = false;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }
  }
  // Start dragging if pointer is within overlay bounds
  if (Math.abs(localX) <= w / 2 && Math.abs(localY) <= h / 2) {
    dragging = true;
    dragData.localX = localX;
    dragData.localY = localY;
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!bgImg) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
  // If the user is selecting an erase region
  if (erasing) {
    eraseEnd = { x, y };
    drawScene();
    return;
  }
  if (!overlayImg) return;
  const w = overlayImg.width * Math.abs(overlayState.scale);
  const h = overlayImg.height * Math.abs(overlayState.scale);
  const cx = overlayState.x + w / 2;
  const cy = overlayState.y + h / 2;
  const angleRad = (overlayState.angle * Math.PI) / 180;
  // If cropping, update the end point and redraw
  if (cropping) {
    const rectMov = canvas.getBoundingClientRect();
    const px = ((e.clientX - rectMov.left) / rectMov.width) * canvas.width;
    const py = ((e.clientY - rectMov.top) / rectMov.height) * canvas.height;
    const dxp = px - cx;
    const dyp = py - cy;
    const angleR = (-overlayState.angle * Math.PI) / 180;
    const localXS = dxp * Math.cos(angleR) - dyp * Math.sin(angleR);
    const localYS = dxp * Math.sin(angleR) + dyp * Math.cos(angleR);
    const unscaledX = localXS / overlayState.scale;
    const unscaledY = localYS / overlayState.scale;
    cropEnd = { x: unscaledX, y: unscaledY };
    drawScene();
    return;
  }
  // If resizing, adjust scale based on handle movement
  if (resizing) {
    // Transform pointer into overlay local space (accounting for rotation)
    const dxPointer = x - cx;
    const dyPointer = y - cy;
    const localX = dxPointer * Math.cos(-angleRad) - dyPointer * Math.sin(-angleRad);
    const localY = dxPointer * Math.sin(-angleRad) + dyPointer * Math.cos(-angleRad);
    // Determine new half‑width and half‑height based on pointer
    // We use absolute values since scale applies symmetrically about centre
    const halfW = Math.abs(localX);
    const halfH = Math.abs(localY);
    // Compute provisional scale factors along each axis
    const scaleX = (2 * halfW) / overlayImg.width;
    const scaleY = (2 * halfH) / overlayImg.height;
    // Maintain aspect ratio by choosing the smaller scale (so the overlay fits within the dragged rectangle)
    let newScale = Math.min(scaleX, scaleY);
    // Clamp newScale to a reasonable range
    const maxScale = Math.min(bgImg.width / overlayImg.width, bgImg.height / overlayImg.height);
    newScale = Math.min(newScale, maxScale);
    const minScale = 0.05;
    if (newScale < minScale) newScale = minScale;
    // Update overlay scale
    overlayState.scale = newScale;
    // Recalculate new width and height
    const newW = overlayImg.width * newScale;
    const newH = overlayImg.height * newScale;
    // Keep centre fixed during resize
    overlayState.x = cx - newW / 2;
    overlayState.y = cy - newH / 2;
    // Clamp x,y to keep overlay inside background
    overlayState.x = Math.max(0, Math.min(overlayState.x, bgImg.width - newW));
    overlayState.y = Math.max(0, Math.min(overlayState.y, bgImg.height - newH));
    drawScene();
    return;
  }
  // Handle dragging overlay
  if (dragging) {
    // Inverse transform local coords to compute new centre
    const dx = dragData.localX;
    const dy = dragData.localY;
    const globalLocalX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
    const globalLocalY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
    const newCx = x - globalLocalX;
    const newCy = y - globalLocalY;
    let newX = newCx - w / 2;
    let newY = newCy - h / 2;
    // Clamp within background bounds
    newX = Math.max(0, Math.min(newX, bgImg.width - w));
    newY = Math.max(0, Math.min(newY, bgImg.height - h));
    overlayState.x = newX;
    overlayState.y = newY;
    drawScene();
    return;
  }
});

canvas.addEventListener('pointerup', (e) => {
  // Finalize erase if in progress
  if (erasing) {
    erasing = false;
    eraseMode = false;
    eraseBtn.textContent = 'Erase';
    canvas.releasePointerCapture(e.pointerId);
    performErase();
    return;
  }
  // If cropping, finalize the crop
  if (cropping) {
    cropping = false;
    cropMode = false;
    cropBtn.textContent = 'Crop';
    canvas.releasePointerCapture(e.pointerId);
    performCrop();
    return;
  }
  if (dragging) {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  }
  if (resizing) {
    resizing = false;
    resizeHandle = -1;
    canvas.releasePointerCapture(e.pointerId);
  }
  // Update undo/redo button states after any interaction
  updateUndoRedoButtons();
});

// Save outputs (async to allow writing files via File System Access API)
saveBtn.addEventListener('click', async () => {
  if (!bgImg || !overlayImg) return;
  // Determine base name for output
  let prefix = outputPrefixInput.value.trim();
  if (!prefix) {
    // default: use background file name if available
    const bgFile = bgInput.files[0];
    if (bgFile) {
      const name = bgFile.name;
      prefix = name.replace(/\.[^.]+$/, '');
    } else {
      prefix = 'output';
    }
  }
  // Compose composite canvas
  const canvasComposite = document.createElement('canvas');
  canvasComposite.width = bgImg.width;
  canvasComposite.height = bgImg.height;
  const ctxC = canvasComposite.getContext('2d');
  ctxC.drawImage(bgImg, 0, 0);
  const w = overlayImg.width * overlayState.scale;
  const h = overlayImg.height * overlayState.scale;
  const cx = overlayState.x + w / 2;
  const cy = overlayState.y + h / 2;
  ctxC.save();
  ctxC.translate(cx, cy);
  ctxC.rotate((overlayState.angle * Math.PI) / 180);
  const sx = overlayState.flipH ? -1 : 1;
  const sy = overlayState.flipV ? -1 : 1;
  ctxC.scale(sx, sy);
  ctxC.scale(overlayState.scale, overlayState.scale);
  ctxC.drawImage(
    overlayImg,
    -overlayImg.width / 2,
    -overlayImg.height / 2
  );
  ctxC.restore();
  const compositeDataUrl = canvasComposite.toDataURL('image/png');
  // Create overlay-only canvas (original keyed)
  const canvasObj = document.createElement('canvas');
  canvasObj.width = overlayOriginalImg.width;
  canvasObj.height = overlayOriginalImg.height;
  const ctxO = canvasObj.getContext('2d');
  ctxO.drawImage(overlayOriginalImg, 0, 0);
  const objectDataUrl = canvasObj.toDataURL('image/png');
  // Determine unique base name
  const baseName = saveCounter === 0 ? prefix : `${prefix}_${saveCounter}`;
  saveCounter++;
  const canvasName = `${baseName}.png`;
  const objectName = `${baseName}.png`;
  // If outputDirHandle is selected, write to disk using File System Access API
  if (outputDirHandle) {
    try {
      // Create subdirectories if not existing
      const canvasDir = await outputDirHandle.getDirectoryHandle('Canvas', { create: true });
      const objectsDir = await outputDirHandle.getDirectoryHandle('objects', { create: true });
      // Write composite
      await writeDataUrlToFile(canvasDir, canvasName, compositeDataUrl);
      await writeDataUrlToFile(objectsDir, objectName, objectDataUrl);
      alert(`Saved to ${canvasDir.name}/${canvasName} and ${objectsDir.name}/${objectName}`);
    } catch (err) {
      console.error('Error writing files via File System Access API:', err);
      // Fallback to download
      downloadDataUrl(compositeDataUrl, `Canvas_${canvasName}`);
      downloadDataUrl(objectDataUrl, `objects_${objectName}`);
    }
  } else {
    // Download via anchor; embed folder names in file name to differentiate
    downloadDataUrl(compositeDataUrl, `Canvas_${canvasName}`);
    downloadDataUrl(objectDataUrl, `objects_${objectName}`);
  }
});

// Helper: write Data URL to a file in a directory using File System Access API
async function writeDataUrlToFile(dirHandle, filename, dataUrl) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  await writable.write(blob);
  await writable.close();
}

// Perform cropping operation on the overlay image using cropStart and cropEnd.
// Cropping is defined in the overlay's local coordinate system (origin at centre, units in original pixels).
function performCrop() {
  // Validate state
  if (!cropStart || !cropEnd || !overlayOriginalImg) return;
  const oldWidth = overlayOriginalImg.width;
  const oldHeight = overlayOriginalImg.height;
  // Determine the rectangle boundaries in local unscaled coordinates
  let x1 = Math.min(cropStart.x, cropEnd.x);
  let x2 = Math.max(cropStart.x, cropEnd.x);
  let y1 = Math.min(cropStart.y, cropEnd.y);
  let y2 = Math.max(cropStart.y, cropEnd.y);
  // Adjust bounds for flips: unflip the selection back to original orientation
  const x1f = overlayState.flipH ? -x2 : x1;
  const x2f = overlayState.flipH ? -x1 : x2;
  const y1f = overlayState.flipV ? -y2 : y1;
  const y2f = overlayState.flipV ? -y1 : y2;
  // Convert to pixel coordinates in the original overlay image
  let u1 = Math.max(0, Math.floor(x1f + oldWidth / 2));
  let u2 = Math.min(oldWidth, Math.ceil(x2f + oldWidth / 2));
  let v1 = Math.max(0, Math.floor(y1f + oldHeight / 2));
  let v2 = Math.min(oldHeight, Math.ceil(y2f + oldHeight / 2));
  const wCrop = u2 - u1;
  const hCrop = v2 - v1;
  if (wCrop <= 0 || hCrop <= 0) {
    // Nothing to crop
    cropStart = null;
    cropEnd = null;
    return;
  }
  // Centre of the crop in unscaled local coordinates
  const cropCenterX = (x1f + x2f) / 2;
  const cropCenterY = (y1f + y2f) / 2;
  // Create off‑screen canvas to extract cropped region
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = wCrop;
  tmpCanvas.height = hCrop;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.drawImage(overlayOriginalImg, -u1, -v1);
  const dataURL = tmpCanvas.toDataURL();
  const newImg = new Image();
  newImg.onload = () => {
    // Update overlay images
    overlayImg = newImg;
    overlayOriginalImg = newImg;
    // Compute global shift: how far the crop centre is from the overlay centre
    const scale = overlayState.scale;
    const angleRad = (overlayState.angle * Math.PI) / 180;
    const deltaX = cropCenterX * scale;
    const deltaY = cropCenterY * scale;
    const shiftX = deltaX * Math.cos(angleRad) - deltaY * Math.sin(angleRad);
    const shiftY = deltaX * Math.sin(angleRad) + deltaY * Math.cos(angleRad);
    // Compute old global centre
    const oldCentreX = overlayState.x + (oldWidth * scale) / 2;
    const oldCentreY = overlayState.y + (oldHeight * scale) / 2;
    // Compute new overlay dimensions (scaled)
    const newWidthScaled = wCrop * scale;
    const newHeightScaled = hCrop * scale;
    // New centre after cropping
    let newCentreX = oldCentreX + shiftX;
    let newCentreY = oldCentreY + shiftY;
    // Compute new top‑left position
    let newX = newCentreX - newWidthScaled / 2;
    let newY = newCentreY - newHeightScaled / 2;
    // Clamp within background bounds
    newX = Math.max(0, Math.min(newX, bgImg.width - newWidthScaled));
    newY = Math.max(0, Math.min(newY, bgImg.height - newHeightScaled));
    overlayState.x = newX;
    overlayState.y = newY;
    // Reset crop state
    cropStart = null;
    cropEnd = null;
    drawScene();
    // Update undo/redo button states after cropping
    updateUndoRedoButtons();
  };
  newImg.src = dataURL;
}

// Perform an erase operation on the background using Bria's generative erase API.
// This function sends the selected area as a mask and updates the background with the result.
async function performErase() {
  // Validate state
  if (!eraseStart || !eraseEnd || !bgImg) return;
  // Compute bounding rectangle of the erase region in canvas coordinates
  const x1 = Math.min(eraseStart.x, eraseEnd.x);
  const y1 = Math.min(eraseStart.y, eraseEnd.y);
  const x2 = Math.max(eraseStart.x, eraseEnd.x);
  const y2 = Math.max(eraseStart.y, eraseEnd.y);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) {
    // Empty selection; nothing to erase
    eraseStart = null;
    eraseEnd = null;
    return;
  }
  try {
    // Disable erase button while processing
    eraseBtn.disabled = true;
    eraseBtn.textContent = 'Erasing...';
    // Create an off‑screen canvas for the background image only
    const imgCanvas = document.createElement('canvas');
    imgCanvas.width = bgImg.width;
    imgCanvas.height = bgImg.height;
    const imgCtx = imgCanvas.getContext('2d');
    imgCtx.drawImage(bgImg, 0, 0);
    // Generate mask: black everywhere, white on selected region
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = bgImg.width;
    maskCanvas.height = bgImg.height;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.fillStyle = 'white';
    maskCtx.fillRect(x1, y1, w, h);
    // Convert images to base64 strings (remove the prefix)
    const imgDataUrl = imgCanvas.toDataURL('image/png');
    const maskDataUrl = maskCanvas.toDataURL('image/png');
    const imgBase64 = imgDataUrl.split(',')[1];
    const maskBase64 = maskDataUrl.split(',')[1];
    // Prepare request payload
    const payload = {
      image: imgBase64,
      mask: maskBase64,
      sync: true,
    };
    const response = await fetch('https://engine.prod.bria-api.com/v2/image/edit/erase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api_token': 'a9aac20fdf824e8ab8d70a815c570d54',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error('Erase API request failed:', response.status, response.statusText);
      // Reset selection since no new image was returned
      eraseStart = null;
      eraseEnd = null;
      drawScene();
      eraseBtn.disabled = false;
      eraseBtn.textContent = 'Erase';
      return;
    }
    const data = await response.json();
    if (data.result && data.result.image_url) {
      const newImageUrl = data.result.image_url;
      // Load the new background image
      const newImg = new Image();
      // Use crossOrigin anonymous to avoid tainting canvas if possible
      newImg.crossOrigin = 'anonymous';
      newImg.onload = () => {
        bgImg = newImg;
        eraseStart = null;
        eraseEnd = null;
        eraseBtn.disabled = false;
        eraseBtn.textContent = 'Erase';
        drawScene();
        updateUndoRedoButtons();
      };
      newImg.src = newImageUrl;
    } else {
      console.error('Erase API returned invalid response:', data);
      // Reset selection since no new image was returned
      eraseStart = null;
      eraseEnd = null;
      drawScene();
      eraseBtn.disabled = false;
      eraseBtn.textContent = 'Erase';
    }
  } catch (err) {
    console.error('Error performing erase:', err);
    // Reset selection on error
    eraseStart = null;
    eraseEnd = null;
    drawScene();
    eraseBtn.disabled = false;
    eraseBtn.textContent = 'Erase';
  }
}

function downloadDataUrl(dataUrl, filename) {
  // Create a blob from data URL
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Disable context menu on canvas to prevent default right‑click behaviour
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});