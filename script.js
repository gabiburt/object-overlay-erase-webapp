// Front‑end logic for the Image Overlay Web App.
// This script implements an interactive canvas where a user can load a
// background and an overlay image (with a grey matte), drag the overlay
// around, resize it, rotate it, flip it horizontally or vertically and
// export two images: the composited canvas and the keyed overlay only.

/* Global state */
let bgImg = null;              // HTMLImageElement for background
// Support multiple overlays. Each overlay is an object with
// {img, originalImg, state, cropMode, cropping, cropStart, cropEnd}
let overlays = [];
// Index of the currently active overlay in the overlays array. -1 if none.
let activeOverlayIndex = -1;
// References for the active overlay. These will point at the currently
// selected overlay's image and state. They are updated whenever the
// active overlay changes.
let overlayImg = null;
let overlayOriginalImg = null;
let overlayState = {
  x: 0,
  y: 0,
  scale: 1,
  angle: 0,   // degrees
  flipH: false,
  flipV: false,
};
/**
 * Update global overlayImg, overlayOriginalImg and overlayState to point
 * to the currently active overlay. If there is no active overlay these
 * references are cleared and a default state is used.
 */
function updateActiveOverlayRefs() {
  if (activeOverlayIndex < 0 || activeOverlayIndex >= overlays.length) {
    overlayImg = null;
    overlayOriginalImg = null;
    // Reset overlayState to a default object so that UI bindings remain valid.
    overlayState = { x: 0, y: 0, scale: 1, angle: 0, flipH: false, flipV: false };
    return;
  }
  const ov = overlays[activeOverlayIndex];
  overlayImg = ov.img;
  overlayOriginalImg = ov.originalImg;
  overlayState = ov.state;
}

/**
 * Restore the overlays array from serialized data and set the active overlay.
 * @param {Array} overlaysData Array of serialized overlay data (objects with imgData, originalData, state, cropMode, etc.).
 * @param {number} activeIdx Index of the overlay to set active.
 * @returns {Promise<void>} Resolves when all images are loaded and references updated.
 */
function restoreOverlaysFromData(overlaysData, activeIdx) {
  overlays = [];
  activeOverlayIndex = -1;
  if (!overlaysData || overlaysData.length === 0) {
    updateActiveOverlayRefs();
    return Promise.resolve();
  }
  const loadPromises = [];
  overlaysData.forEach((data, index) => {
    const ov = {
      img: null,
      originalImg: null,
      state: { ...data.state },
      cropMode: data.cropMode || false,
      cropping: data.cropping || false,
      cropStart: data.cropStart ? { ...data.cropStart } : null,
      cropEnd: data.cropEnd ? { ...data.cropEnd } : null,
    };
    overlays.push(ov);
    if (data.imgData) {
      const p = new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
          ov.img = im;
          // original keyed overlay is identical to keyed overlay in this app
          ov.originalImg = im;
          resolve();
        };
        im.src = data.imgData;
      });
      loadPromises.push(p);
    }
  });
  return Promise.all(loadPromises).then(() => {
    // Set active overlay index
    if (typeof activeIdx === 'number' && activeIdx >= 0 && activeIdx < overlays.length) {
      activeOverlayIndex = activeIdx;
    } else {
      activeOverlayIndex = overlays.length - 1;
    }
    updateActiveOverlayRefs();
  });
}
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
// Crop button. Cropping state is stored per overlay inside the overlays array.
const cropBtn = document.getElementById('crop');

// Erase button and erasing state variables
const eraseBtn = document.getElementById('erase');
// Select element for choosing erase method (rectangle or brush)
const eraseMethodSelect = document.getElementById('erase-method');
// Range slider for brush size
const brushSizeSlider = document.getElementById('brush-size');
const brushSizeLabel = document.getElementById('brush-size-label');
// Current erase method: 'rect' or 'brush'
let eraseMethod = 'rect';
// Toggle for erase mode (true when the user has clicked the Erase button and is selecting an area)
let eraseMode = false;
// True while the user is selecting an erase region on the background (rectangle) or drawing a brush path
let erasing = false;
// Start and end points of the erase rectangle in canvas coordinates (used only for rectangle mode)
let eraseStart = null;
let eraseEnd = null;
// Brush path: array of {x,y} points collected when drawing with brush
let brushPath = [];
// Current brush radius in pixels (controlled via slider)
let brushRadius = parseInt(brushSizeSlider ? brushSizeSlider.value : 20, 10) || 20;

// Undo/Redo state and buttons. We maintain a stack of previous states
// (undoStack) and a stack of undone states (redoStack). Each state stores
// the overlay image data URL, the original keyed overlay data URL and the
// overlayState parameters. This allows reverting and re‑applying edits such as
// moves, resizes, rotations, flips and cropping.
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const undoStack = [];
const redoStack = [];

// Initialise erase method and brush UI behaviour
if (eraseMethodSelect) {
  // Update eraseMethod based on dropdown selection
  eraseMethodSelect.addEventListener('change', (e) => {
    eraseMethod = e.target.value || 'rect';
    // Show or hide the brush size slider depending on the method
    if (eraseMethod === 'brush' && brushSizeLabel) {
      brushSizeLabel.style.display = '';
    } else if (brushSizeLabel) {
      brushSizeLabel.style.display = 'none';
    }
  });
}
if (brushSizeSlider) {
  brushSizeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val)) {
      brushRadius = val;
    }
  });
}

// Save the current overlay state onto the undo stack and clear the redo
// stack. Only saves when an overlay exists. Called at the beginning of
// interactive actions (dragging, resizing, rotating, flipping, cropping).
function saveState() {
  // Only record a state when a background image exists
  if (!bgImg) return;
  // Deep copy all overlay state. Each overlay stores its image data URL and its
  // transformation state so we can fully restore it during undo/redo.
  const overlaysData = overlays.map((o) => {
    return {
      imgData: o.img ? o.img.src : null,
      originalData: o.originalImg ? o.originalImg.src : null,
      state: { ...o.state },
      cropMode: o.cropMode || false,
      cropping: o.cropping || false,
      cropStart: o.cropStart ? { ...o.cropStart } : null,
      cropEnd: o.cropEnd ? { ...o.cropEnd } : null,
    };
  });
  const bgData = bgImg ? bgImg.src : null;
  const activeIndex = activeOverlayIndex;
  undoStack.push({ overlaysData, bgData, activeIndex });
  // Whenever we push a new state, clear the redo history
  redoStack.length = 0;
  updateUndoRedoButtons();
}

// Restore the most recent state from the undo stack. The current state is
// pushed onto the redo stack before restoring. If no undo is available the
// function does nothing.
function undo() {
  if (undoStack.length === 0) return;
  // Push current state onto redo stack. Serialize the overlays and background.
  if (bgImg) {
    const overlaysData = overlays.map((o) => ({
      imgData: o.img ? o.img.src : null,
      originalData: o.originalImg ? o.originalImg.src : null,
      state: { ...o.state },
      cropMode: o.cropMode || false,
      cropping: o.cropping || false,
      cropStart: o.cropStart ? { ...o.cropStart } : null,
      cropEnd: o.cropEnd ? { ...o.cropEnd } : null,
    }));
    redoStack.push({ overlaysData, bgData: bgImg.src, activeIndex: activeOverlayIndex });
  }
  const prev = undoStack.pop();
  if (!prev) return;
  // Restore overlays and background from previous state
  const { overlaysData, bgData, activeIndex } = prev;
  // Restore overlays (async) then restore background
  restoreOverlaysFromData(overlaysData, activeIndex).then(() => {
    if (bgData) {
      const bimg = new Image();
      bimg.onload = () => {
        bgImg = bimg;
        drawScene();
        updateUndoRedoButtons();
      };
      bimg.src = bgData;
    } else {
      drawScene();
      updateUndoRedoButtons();
    }
  });
}

// Reapply the most recently undone state from the redo stack. The current
// state is pushed back to the undo stack before restoring. If no redo is
// available the function does nothing.
function redo() {
  if (redoStack.length === 0) return;
  // Push current state onto undo stack
  if (bgImg) {
    const overlaysData = overlays.map((o) => ({
      imgData: o.img ? o.img.src : null,
      originalData: o.originalImg ? o.originalImg.src : null,
      state: { ...o.state },
      cropMode: o.cropMode || false,
      cropping: o.cropping || false,
      cropStart: o.cropStart ? { ...o.cropStart } : null,
      cropEnd: o.cropEnd ? { ...o.cropEnd } : null,
    }));
    undoStack.push({ overlaysData, bgData: bgImg.src, activeIndex: activeOverlayIndex });
  }
  const next = redoStack.pop();
  if (!next) return;
  const { overlaysData, bgData, activeIndex } = next;
  restoreOverlaysFromData(overlaysData, activeIndex).then(() => {
    if (bgData) {
      const bimg = new Image();
      bimg.onload = () => {
        bgImg = bimg;
        drawScene();
        updateUndoRedoButtons();
      };
      bimg.src = bgData;
    } else {
      drawScene();
      updateUndoRedoButtons();
    }
  });
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
  // Crop button only works when an overlay is loaded and selected
  if (!overlayImg || activeOverlayIndex < 0) return;
  const ov = overlays[activeOverlayIndex];
  if (!ov.cropMode) {
    // Save current state before entering crop mode for undo
    saveState();
    // Enter crop mode for this overlay
    ov.cropMode = true;
    ov.cropping = false;
    ov.cropStart = null;
    ov.cropEnd = null;
    cropBtn.textContent = 'Cancel Crop';
  } else {
    // Exit crop mode without applying crop
    ov.cropMode = false;
    ov.cropping = false;
    ov.cropStart = null;
    ov.cropEnd = null;
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
    // Reset selection states for both rectangle and brush methods
    eraseStart = null;
    eraseEnd = null;
    brushPath = [];
    eraseBtn.textContent = 'Cancel Erase';
  } else {
    // Cancel erase mode without applying erase
    eraseMode = false;
    erasing = false;
    eraseStart = null;
    eraseEnd = null;
    brushPath = [];
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
  // Draw overlays if any
  if (overlays.length > 0) {
    overlays.forEach((ov, idx) => {
      if (!ov.img) return;
      const w = ov.img.width * Math.abs(ov.state.scale);
      const h = ov.img.height * Math.abs(ov.state.scale);
      const cx = ov.state.x + w / 2;
      const cy = ov.state.y + h / 2;
      // Draw the overlay image with its transform
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((ov.state.angle * Math.PI) / 180);
      const sx = ov.state.flipH ? -1 : 1;
      const sy = ov.state.flipV ? -1 : 1;
      ctx.scale(sx, sy);
      ctx.scale(ov.state.scale, ov.state.scale);
      ctx.drawImage(ov.img, -ov.img.width / 2, -ov.img.height / 2);
      ctx.restore();
      // If this is the active overlay, draw bounding box and handles
      if (idx === activeOverlayIndex) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((ov.state.angle * Math.PI) / 180);
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
          { x: -w / 2, y: h / 2 },
        ];
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1;
        corners.forEach((c) => {
          ctx.beginPath();
          ctx.rect(c.x - halfHandle, c.y - halfHandle, handleSize, handleSize);
          ctx.fill();
          ctx.stroke();
        });
        // If cropping is active or in progress for this overlay, draw the selection rectangle
        if ((ov.cropMode || ov.cropping) && ov.cropStart && ov.cropEnd) {
          // Determine rectangle in local unscaled coordinates
          let sxU = Math.min(ov.cropStart.x, ov.cropEnd.x);
          let exU = Math.max(ov.cropStart.x, ov.cropEnd.x);
          let syU = Math.min(ov.cropStart.y, ov.cropEnd.y);
          let eyU = Math.max(ov.cropStart.y, ov.cropEnd.y);
          // Apply flips for display
          const dispX1 = (ov.state.flipH ? -exU : sxU) * ov.state.scale;
          const dispX2 = (ov.state.flipH ? -sxU : exU) * ov.state.scale;
          const dispY1 = (ov.state.flipV ? -eyU : syU) * ov.state.scale;
          const dispY2 = (ov.state.flipV ? -syU : eyU) * ov.state.scale;
          const rectX = dispX1;
          const rectY = dispY1;
          const rectW = dispX2 - dispX1;
          const rectH = dispY2 - dispY1;
          ctx.save();
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
    });
  }
  // Draw the erase selection overlay when erasing
  if (eraseMode || erasing) {
    // Brush preview: draw circles along the brush path if using brush method
    if (eraseMethod === 'brush' && brushPath && brushPath.length > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.strokeStyle = 'rgba(0, 0, 255, 0.8)';
      ctx.lineWidth = 1;
      brushPath.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, brushRadius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();
    }
    // Rectangle preview: draw selection rectangle if using rectangle method
    if (eraseMethod === 'rect' && eraseStart && eraseEnd) {
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
    // If overlays exist, ensure each overlay fits within new background bounds
    if (overlays.length > 0) {
      overlays.forEach((ov) => {
        const maxW = bgImg.width;
        const maxH = bgImg.height;
        const ovW = ov.img ? ov.img.width : 0;
        const ovH = ov.img ? ov.img.height : 0;
        if (ovW === 0 || ovH === 0) return;
        const scaleX = maxW / ovW;
        const scaleY = maxH / ovH;
        const maxScale = Math.min(scaleX, scaleY, 1);
        // Keep the current scale if it's smaller; otherwise reduce to maxScale
        ov.state.scale = Math.min(ov.state.scale, maxScale);
        // Clamp position inside the new background
        const wScaled = ovW * Math.abs(ov.state.scale);
        const hScaled = ovH * Math.abs(ov.state.scale);
        ov.state.x = Math.max(0, Math.min(ov.state.x, bgImg.width - wScaled));
        ov.state.y = Math.max(0, Math.min(ov.state.y, bgImg.height - hScaled));
      });
    }
    // Show controls if there is at least one overlay; allow setting output directory and erasing
    controls.style.display = overlays.length > 0 ? 'flex' : 'none';
    saveBtn.disabled = overlays.length === 0;
    setOutputBtn.disabled = false;
    eraseBtn.disabled = false;
  };
  img.src = URL.createObjectURL(file);
});

// Event: load overlay(s)
overlayInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  // Only allow adding overlays if a background exists
  if (files.length === 0 || !bgImg) return;
  // Determine whether this is the first overlay being added
  const isFirstOverlay = overlays.length === 0;
  // If not the first overlay, save current state so the addition can be undone
  if (!isFirstOverlay) {
    saveState();
  } else {
    // For the first overlay, clear undo/redo stacks before saving initial state
    undoStack.length = 0;
    redoStack.length = 0;
  }
  let filesProcessed = 0;
  files.forEach((file) => {
    const rawImg = new Image();
    rawImg.onload = () => {
      applyGreyKey(rawImg, (rgbaImg) => {
        const maxW = bgImg.width;
        const maxH = bgImg.height;
        const ovW = rgbaImg.width;
        const ovH = rgbaImg.height;
        const scaleX = maxW / ovW;
        const scaleY = maxH / ovH;
        const maxScale = Math.min(scaleX, scaleY, 1);
        // Construct a new overlay object with default state
        const ov = {
          img: rgbaImg,
          originalImg: rgbaImg,
          state: {
            x: Math.min(20, maxW - ovW * maxScale),
            y: Math.min(20, maxH - ovH * maxScale),
            scale: maxScale,
            angle: 0,
            flipH: false,
            flipV: false,
          },
          cropMode: false,
          cropping: false,
          cropStart: null,
          cropEnd: null,
        };
        overlays.push(ov);
        activeOverlayIndex = overlays.length - 1;
        // Set active overlay references to the newly added overlay
        updateActiveOverlayRefs();
        filesProcessed++;
        // Once all selected files are processed, update UI and save state
        if (filesProcessed === files.length) {
          controls.style.display = 'flex';
          saveBtn.disabled = false;
          removeOverlayBtn.disabled = false;
          angleInput.value = 0;
          cropBtn.disabled = false;
          cropBtn.textContent = 'Crop';
          // Save the new state so addition can be undone
          saveState();
          drawScene();
        }
      });
    };
    rawImg.src = URL.createObjectURL(file);
  });
  // Reset input value to allow uploading the same file again
  overlayInput.value = '';
});

// Remove overlay
removeOverlayBtn.addEventListener('click', () => {
  // Remove the currently active overlay from the list
  if (activeOverlayIndex < 0 || overlays.length === 0) return;
  // Save current state for undo
  saveState();
  overlays.splice(activeOverlayIndex, 1);
  // Adjust active overlay index
  if (overlays.length === 0) {
    activeOverlayIndex = -1;
  } else {
    // If we removed the last element, move active index to new last
    if (activeOverlayIndex >= overlays.length) {
      activeOverlayIndex = overlays.length - 1;
    }
  }
  updateActiveOverlayRefs();
  // Update UI: disable controls if no overlays remain
  if (!overlayImg) {
    saveBtn.disabled = true;
    removeOverlayBtn.disabled = true;
    cropBtn.disabled = true;
    cropBtn.textContent = 'Crop';
  }
  drawScene();
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
  // Clear overlays and reset active overlay
  overlays = [];
  activeOverlayIndex = -1;
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
  // Disable crop functionality for new session
  cropBtn.disabled = true;
  cropBtn.textContent = 'Crop';
  // Reset erase state and disable erase button
  eraseBtn.disabled = true;
  eraseMode = false;
  erasing = false;
  eraseStart = null;
  eraseEnd = null;
  brushPath = [];
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
    // Rectangle selection mode
    if (eraseMethod === 'rect') {
      erasing = true;
      eraseStart = { x, y };
      eraseEnd = { x, y };
      canvas.setPointerCapture(e.pointerId);
      drawScene();
      e.preventDefault();
      return;
    }
    // Brush selection mode
    if (eraseMethod === 'brush') {
      erasing = true;
      brushPath = [];
      brushPath.push({ x, y });
      canvas.setPointerCapture(e.pointerId);
      // Draw initial brush point overlay
      drawScene();
      e.preventDefault();
      return;
    }
  }
  // Determine which overlay (if any) is under the pointer. Iterate from topmost to bottom.
  let foundIndex = -1;
  for (let i = overlays.length - 1; i >= 0; i--) {
    const ov = overlays[i];
    const wOv = ov.img.width * Math.abs(ov.state.scale);
    const hOv = ov.img.height * Math.abs(ov.state.scale);
    const cxOv = ov.state.x + wOv / 2;
    const cyOv = ov.state.y + hOv / 2;
    // Translate pointer into this overlay's local space
    const dxOv = x - cxOv;
    const dyOv = y - cyOv;
    const angleRadOv = (-ov.state.angle * Math.PI) / 180;
    const localXOv = dxOv * Math.cos(angleRadOv) - dyOv * Math.sin(angleRadOv);
    const localYOv = dxOv * Math.sin(angleRadOv) + dyOv * Math.cos(angleRadOv);
    if (Math.abs(localXOv) <= wOv / 2 && Math.abs(localYOv) <= hOv / 2) {
      foundIndex = i;
      break;
    }
  }
  // If an overlay was clicked, make it active (move to top) and update references
  if (foundIndex >= 0) {
    // Bring the found overlay to the top of the stacking order if it's not already topmost
    const ov = overlays[foundIndex];
    overlays.splice(foundIndex, 1);
    overlays.push(ov);
    activeOverlayIndex = overlays.length - 1;
    updateActiveOverlayRefs();
    // Cancel crop mode of all other overlays
    overlays.forEach((o, idx) => {
      if (idx !== activeOverlayIndex && o.cropMode) {
        o.cropMode = false;
        o.cropping = false;
        o.cropStart = null;
        o.cropEnd = null;
      }
    });
  }
  // If no overlay is active after selection, exit
  if (!overlayImg || activeOverlayIndex < 0) {
    return;
  }
  // Compute overlay dimensions and local coordinates for the active overlay
  const w = overlayImg.width * Math.abs(overlayState.scale);
  const h = overlayImg.height * Math.abs(overlayState.scale);
  const cx = overlayState.x + w / 2;
  const cy = overlayState.y + h / 2;
  const dx = x - cx;
  const dy = y - cy;
  const angleRad = (-overlayState.angle * Math.PI) / 180;
  const localX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
  const localY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
  // Reference to current active overlay
  const activeOverlay = overlays[activeOverlayIndex];
  // If crop mode is active for the current overlay, begin cropping when clicking inside it
  if (activeOverlay.cropMode) {
    const unscaledX = localX / overlayState.scale;
    const unscaledY = localY / overlayState.scale;
    if (
      Math.abs(unscaledX) <= overlayOriginalImg.width / 2 &&
      Math.abs(unscaledY) <= overlayOriginalImg.height / 2
    ) {
      activeOverlay.cropping = true;
      activeOverlay.cropStart = { x: unscaledX, y: unscaledY };
      activeOverlay.cropEnd = { x: unscaledX, y: unscaledY };
      canvas.setPointerCapture(e.pointerId);
      drawScene();
      e.preventDefault();
      return;
    } else {
      // Clicked outside overlay: cancel crop mode
      activeOverlay.cropMode = false;
      activeOverlay.cropping = false;
      activeOverlay.cropStart = null;
      activeOverlay.cropEnd = null;
      cropBtn.textContent = 'Crop';
      drawScene();
      return;
    }
  }
  // Check for resize handle interactions on the active overlay
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
    // Handle rectangle erase selection
    if (eraseMode && eraseMethod === 'rect') {
      eraseEnd = { x, y };
      drawScene();
      return;
    }
    // Handle brush erase selection
    if (eraseMode && eraseMethod === 'brush') {
      // Append current point to the brush path
      brushPath.push({ x, y });
      drawScene();
      return;
    }
  }
  if (!overlayImg || activeOverlayIndex < 0) return;
  const w = overlayImg.width * Math.abs(overlayState.scale);
  const h = overlayImg.height * Math.abs(overlayState.scale);
  const cx = overlayState.x + w / 2;
  const cy = overlayState.y + h / 2;
  const angleRad = (overlayState.angle * Math.PI) / 180;
  const activeOverlay = overlays[activeOverlayIndex];
  // If the active overlay is currently being cropped, update its crop end point
  if (activeOverlay && activeOverlay.cropping) {
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
    activeOverlay.cropEnd = { x: unscaledX, y: unscaledY };
    drawScene();
    return;
  }
  // If resizing the active overlay, adjust its scale based on handle movement
  if (resizing) {
    const dxPointer = x - cx;
    const dyPointer = y - cy;
    const localX = dxPointer * Math.cos(-angleRad) - dyPointer * Math.sin(-angleRad);
    const localY = dxPointer * Math.sin(-angleRad) + dyPointer * Math.cos(-angleRad);
    const halfW = Math.abs(localX);
    const halfH = Math.abs(localY);
    const scaleX = (2 * halfW) / overlayImg.width;
    const scaleY = (2 * halfH) / overlayImg.height;
    let newScale = Math.min(scaleX, scaleY);
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
    const dx = dragData.localX;
    const dy = dragData.localY;
    const globalLocalX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
    const globalLocalY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
    const newCx = x - globalLocalX;
    const newCy = y - globalLocalY;
    let newX = newCx - w / 2;
    let newY = newCy - h / 2;
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
    // Call appropriate erase function based on method
    if (eraseMethod === 'rect') {
      performErase();
    } else if (eraseMethod === 'brush') {
      performEraseBrush();
    }
    return;
  }
  // If cropping an overlay, finalize the crop
  if (activeOverlayIndex >= 0) {
    const ov = overlays[activeOverlayIndex];
    if (ov.cropping) {
      ov.cropping = false;
      ov.cropMode = false;
      cropBtn.textContent = 'Crop';
      canvas.releasePointerCapture(e.pointerId);
      performCrop();
      return;
    }
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
  // Only save if a background is loaded and there is at least one overlay
  if (!bgImg || overlays.length === 0) return;
  // Determine base name for output
  let prefix = outputPrefixInput.value.trim();
  if (!prefix) {
    const bgFile = bgInput.files[0];
    if (bgFile) {
      const name = bgFile.name;
      prefix = name.replace(/\.[^.]+$/, '');
    } else {
      prefix = 'output';
    }
  }
  // Compose composite canvas: draw background then all overlays in stacking order
  const canvasComposite = document.createElement('canvas');
  canvasComposite.width = bgImg.width;
  canvasComposite.height = bgImg.height;
  const ctxC = canvasComposite.getContext('2d');
  ctxC.drawImage(bgImg, 0, 0);
  // Draw overlays from first to last (bottom to top)
  overlays.forEach((ov) => {
    if (!ov.img) return;
    const wOv = ov.img.width * Math.abs(ov.state.scale);
    const hOv = ov.img.height * Math.abs(ov.state.scale);
    const cxOv = ov.state.x + wOv / 2;
    const cyOv = ov.state.y + hOv / 2;
    ctxC.save();
    ctxC.translate(cxOv, cyOv);
    ctxC.rotate((ov.state.angle * Math.PI) / 180);
    const sxOv = ov.state.flipH ? -1 : 1;
    const syOv = ov.state.flipV ? -1 : 1;
    ctxC.scale(sxOv, syOv);
    ctxC.scale(ov.state.scale, ov.state.scale);
    ctxC.drawImage(ov.img, -ov.img.width / 2, -ov.img.height / 2);
    ctxC.restore();
  });
  const compositeDataUrl = canvasComposite.toDataURL('image/png');
  // Generate overlay-only images and names for each overlay
  const objectDataUrls = [];
  const objectNames = [];
  overlays.forEach((ov, idx) => {
    if (!ov.originalImg) return;
    const canvasObj = document.createElement('canvas');
    canvasObj.width = ov.originalImg.width;
    canvasObj.height = ov.originalImg.height;
    const ctxO = canvasObj.getContext('2d');
    ctxO.drawImage(ov.originalImg, 0, 0);
    const objUrl = canvasObj.toDataURL('image/png');
    objectDataUrls.push(objUrl);
    const baseName = saveCounter === 0 ? `${prefix}_ov${idx + 1}` : `${prefix}_${saveCounter}_ov${idx + 1}`;
    objectNames.push(`${baseName}.png`);
  });
  // Determine composite name; increment saveCounter once for the entire save operation
  const compositeBaseName = saveCounter === 0 ? prefix : `${prefix}_${saveCounter}`;
  const canvasName = `${compositeBaseName}.png`;
  saveCounter++;
  // Save or download files
  if (outputDirHandle) {
    try {
      const canvasDir = await outputDirHandle.getDirectoryHandle('Canvas', { create: true });
      const objectsDir = await outputDirHandle.getDirectoryHandle('objects', { create: true });
      await writeDataUrlToFile(canvasDir, canvasName, compositeDataUrl);
      // Save each overlay object
      for (let i = 0; i < objectDataUrls.length; i++) {
        await writeDataUrlToFile(objectsDir, objectNames[i], objectDataUrls[i]);
      }
      alert(`Saved composite and ${objectDataUrls.length} overlay objects to selected folder.`);
    } catch (err) {
      console.error('Error writing files via File System Access API:', err);
      // Fallback to download
      downloadDataUrl(compositeDataUrl, `Canvas_${canvasName}`);
      for (let i = 0; i < objectDataUrls.length; i++) {
        downloadDataUrl(objectDataUrls[i], `objects_${objectNames[i]}`);
      }
    }
  } else {
    // Fallback: download via anchor with folder prefixes in file names
    downloadDataUrl(compositeDataUrl, `Canvas_${canvasName}`);
    for (let i = 0; i < objectDataUrls.length; i++) {
      downloadDataUrl(objectDataUrls[i], `objects_${objectNames[i]}`);
    }
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
  // Only perform cropping if there is an active overlay
  if (activeOverlayIndex < 0) return;
  const ov = overlays[activeOverlayIndex];
  // Validate state
  if (!ov.cropStart || !ov.cropEnd || !ov.originalImg) return;
  const oldWidth = ov.originalImg.width;
  const oldHeight = ov.originalImg.height;
  // Determine the rectangle boundaries in local unscaled coordinates
  let x1 = Math.min(ov.cropStart.x, ov.cropEnd.x);
  let x2 = Math.max(ov.cropStart.x, ov.cropEnd.x);
  let y1 = Math.min(ov.cropStart.y, ov.cropEnd.y);
  let y2 = Math.max(ov.cropStart.y, ov.cropEnd.y);
  // Adjust bounds for flips: unflip the selection back to original orientation
  const x1f = ov.state.flipH ? -x2 : x1;
  const x2f = ov.state.flipH ? -x1 : x2;
  const y1f = ov.state.flipV ? -y2 : y1;
  const y2f = ov.state.flipV ? -y1 : y2;
  // Convert to pixel coordinates in the original overlay image
  let u1 = Math.max(0, Math.floor(x1f + oldWidth / 2));
  let u2 = Math.min(oldWidth, Math.ceil(x2f + oldWidth / 2));
  let v1 = Math.max(0, Math.floor(y1f + oldHeight / 2));
  let v2 = Math.min(oldHeight, Math.ceil(y2f + oldHeight / 2));
  const wCrop = u2 - u1;
  const hCrop = v2 - v1;
  if (wCrop <= 0 || hCrop <= 0) {
    // Nothing to crop
    ov.cropStart = null;
    ov.cropEnd = null;
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
  tmpCtx.drawImage(ov.originalImg, -u1, -v1);
  const dataURL = tmpCanvas.toDataURL();
  const newImg = new Image();
  newImg.onload = () => {
    // Update overlay images
    ov.img = newImg;
    ov.originalImg = newImg;
    // Compute global shift: how far the crop centre is from the overlay centre
    const scale = ov.state.scale;
    const angleRad = (ov.state.angle * Math.PI) / 180;
    const deltaX = cropCenterX * scale;
    const deltaY = cropCenterY * scale;
    const shiftX = deltaX * Math.cos(angleRad) - deltaY * Math.sin(angleRad);
    const shiftY = deltaX * Math.sin(angleRad) + deltaY * Math.cos(angleRad);
    // Compute old global centre
    const oldCentreX = ov.state.x + (oldWidth * scale) / 2;
    const oldCentreY = ov.state.y + (oldHeight * scale) / 2;
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
    ov.state.x = newX;
    ov.state.y = newY;
    // Reset crop state
    ov.cropStart = null;
    ov.cropEnd = null;
    ov.cropMode = false;
    ov.cropping = false;
    cropBtn.textContent = 'Crop';
    updateActiveOverlayRefs();
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

/**
 * Perform a generative erase using a freeform brush path. The brushPath array
 * contains canvas coordinates representing the centre points of a circular
 * brush. A mask is constructed by drawing filled circles of the current
 * brush radius at each recorded point. The Bria erase API is called with
 * the background image and the generated mask. On success, the background
 * image is updated and the brushPath is cleared.
 */
async function performEraseBrush() {
  if (!bgImg || !brushPath || brushPath.length === 0) {
    brushPath = [];
    drawScene();
    return;
  }
  try {
    eraseBtn.disabled = true;
    eraseBtn.textContent = 'Erasing...';
    // Create an off‑screen canvas for the background image only
    const imgCanvas = document.createElement('canvas');
    imgCanvas.width = bgImg.width;
    imgCanvas.height = bgImg.height;
    const imgCtx = imgCanvas.getContext('2d');
    imgCtx.drawImage(bgImg, 0, 0);
    // Create a mask canvas: black background
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = bgImg.width;
    maskCanvas.height = bgImg.height;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    // Draw white circles along the brush path
    maskCtx.fillStyle = 'white';
    brushPath.forEach((pt) => {
      maskCtx.beginPath();
      maskCtx.arc(pt.x, pt.y, brushRadius, 0, 2 * Math.PI);
      maskCtx.fill();
    });
    // Convert canvases to base64 strings
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
      console.error('Brush erase API request failed:', response.status, response.statusText);
      brushPath = [];
      drawScene();
      eraseBtn.disabled = false;
      eraseBtn.textContent = 'Erase';
      return;
    }
    const data = await response.json();
    if (data.result && data.result.image_url) {
      const newImageUrl = data.result.image_url;
      const newImg = new Image();
      newImg.crossOrigin = 'anonymous';
      newImg.onload = () => {
        bgImg = newImg;
        brushPath = [];
        eraseBtn.disabled = false;
        eraseBtn.textContent = 'Erase';
        drawScene();
        updateUndoRedoButtons();
      };
      newImg.src = newImageUrl;
    } else {
      console.error('Brush erase API returned invalid response:', data);
      brushPath = [];
      drawScene();
      eraseBtn.disabled = false;
      eraseBtn.textContent = 'Erase';
    }
  } catch (err) {
    console.error('Error performing brush erase:', err);
    brushPath = [];
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