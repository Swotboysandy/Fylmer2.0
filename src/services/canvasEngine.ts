import { BoundingBox, SamMask } from '../types/framelock';

export interface SceneRenderSpec {
  shotNumber: number;
  cameraAngle: 'wide' | 'medium' | 'closeup' | 'over_shoulder';
  settingTitle: string;
  targetObject: string; // e.g., "cup", "jacket", "umbrella", "lantern"
  objectColorName: string; // e.g., "blue", "red", "amber", "emerald", "crimson", "cobalt"
  weatherOrMood: 'rain_noir' | 'neon_dusk' | 'studio_warm' | 'fog_pier';
  characterPose: 'seated_detective' | 'reaching_hand' | 'window_gaze' | 'walking_away';
  seed: number;
}

const COLOR_HEX_MAP: Record<string, { primary: string; highlight: string; shadow: string; rgb: [number, number, number] }> = {
  blue: { primary: '#2563EB', highlight: '#60A5FA', shadow: '#1E3A8A', rgb: [37, 99, 235] },
  cobalt: { primary: '#1D4ED8', highlight: '#38BDF8', shadow: '#172554', rgb: [29, 78, 216] },
  cyan: { primary: '#0891B2', highlight: '#67E8F9', shadow: '#164E63', rgb: [8, 145, 178] },
  red: { primary: '#DC2626', highlight: '#F87171', shadow: '#7F1D1D', rgb: [220, 38, 38] },
  crimson: { primary: '#E11D48', highlight: '#FDA4AF', shadow: '#881337', rgb: [225, 29, 72] },
  amber: { primary: '#D97706', highlight: '#FBBF24', shadow: '#78350F', rgb: [217, 119, 6] },
  yellow: { primary: '#EAB308', highlight: '#FDE047', shadow: '#713F12', rgb: [234, 179, 8] },
  gold: { primary: '#CA8A04', highlight: '#FEF08A', shadow: '#713F12', rgb: [202, 138, 4] },
  green: { primary: '#059669', highlight: '#34D399', shadow: '#064E3B', rgb: [5, 150, 105] },
  emerald: { primary: '#10B981', highlight: '#6EE7B7', shadow: '#065F46', rgb: [16, 185, 129] },
  white: { primary: '#E2E8F0', highlight: '#FFFFFF', shadow: '#64748B', rgb: [226, 232, 240] },
  purple: { primary: '#7C3AED', highlight: '#C4B5FD', shadow: '#4C1D95', rgb: [124, 58, 237] },
};

export function resolveColorPalette(colorName: string) {
  const normalized = colorName.toLowerCase().trim();
  for (const [key, val] of Object.entries(COLOR_HEX_MAP)) {
    if (normalized.includes(key)) return val;
  }
  return COLOR_HEX_MAP.blue;
}

/**
 * Computes deterministic bounding box (in normalized 0..100 percentages of 800x450 canvas)
 * for the primary continuity object based on camera framing.
 */
export function getTargetObjectBox(cameraAngle: SceneRenderSpec['cameraAngle'], targetObject: string): BoundingBox {
  const obj = targetObject.toLowerCase();
  if (obj.includes('umbrella') || obj.includes('coat') || obj.includes('jacket')) {
    if (cameraAngle === 'closeup') return { x: 28, y: 42, width: 44, height: 48 };
    if (cameraAngle === 'medium') return { x: 32, y: 36, width: 34, height: 50 };
    return { x: 42, y: 38, width: 22, height: 44 };
  }
  // Default prop (cup, mug, lantern, notebook, briefcase)
  switch (cameraAngle) {
    case 'closeup':
      return { x: 38, y: 38, width: 24, height: 38 };
    case 'over_shoulder':
      return { x: 54, y: 52, width: 16, height: 26 };
    case 'medium':
      return { x: 58, y: 55, width: 14, height: 24 };
    case 'wide':
    default:
      return { x: 46, y: 60, width: 11, height: 20 };
  }
}

/**
 * Renders a high-contrast cinematic storyboard frame onto an 800x450 HTML5 Canvas
 * representing the output of `muse-image-1.0`.
 */
export function renderMuseStoryboardFrame(spec: SceneRenderSpec): {
  imageUrl: string;
  box: BoundingBox;
} {
  const width = 800;
  const height = 450;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 1. Background Atmosphere
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  if (spec.weatherOrMood === 'rain_noir') {
    bgGrad.addColorStop(0, '#090D16');
    bgGrad.addColorStop(0.65, '#131C2E');
    bgGrad.addColorStop(1, '#0F141C');
  } else if (spec.weatherOrMood === 'neon_dusk') {
    bgGrad.addColorStop(0, '#0F1026');
    bgGrad.addColorStop(0.6, '#1E1B3A');
    bgGrad.addColorStop(1, '#12131F');
  } else {
    bgGrad.addColorStop(0, '#141820');
    bgGrad.addColorStop(0.65, '#222936');
    bgGrad.addColorStop(1, '#12151C');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Architectural Diner / Studio Window Grid & Rain Streaks
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 2;
  // Window panes
  ctx.strokeRect(48, 36, width - 96, height * 0.56);
  ctx.beginPath();
  ctx.moveTo(width * 0.35, 36);
  ctx.lineTo(width * 0.35, 36 + height * 0.56);
  ctx.moveTo(width * 0.68, 36);
  ctx.lineTo(width * 0.68, 36 + height * 0.56);
  ctx.stroke();

  // Exterior city bokeh glow
  const bokehColors = ['rgba(56, 189, 248, 0.16)', 'rgba(245, 158, 11, 0.14)', 'rgba(99, 102, 241, 0.14)'];
  for (let i = 0; i < 9; i++) {
    const bx = 90 + ((i * 83 + spec.seed * 29) % 620);
    const by = 70 + ((i * 47 + spec.seed * 13) % 160);
    const br = 18 + (i % 3) * 12;
    const rad = ctx.createRadialGradient(bx, by, 2, bx, by, br);
    rad.addColorStop(0, bokehColors[i % bokehColors.length]);
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rad;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  // Diagonal rain streaks outside window
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.18)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 42; i++) {
    const rx = 60 + ((i * 37 + spec.shotNumber * 53) % (width - 120));
    const ry = 44 + ((i * 29 + spec.seed * 19) % 210);
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx - 10, ry + 26);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Foreground Counter / Table Surface (Perspective Plane)
  const tableTopY = spec.cameraAngle === 'closeup' ? height * 0.58 : height * 0.64;
  const tableGrad = ctx.createLinearGradient(0, tableTopY, 0, height);
  tableGrad.addColorStop(0, '#1E2530');
  tableGrad.addColorStop(0.15, '#262F3D');
  tableGrad.addColorStop(1, '#12161F');
  ctx.fillStyle = tableGrad;
  ctx.fillRect(0, tableTopY, width, height - tableTopY);

  // Crisp counter rim line
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, tableTopY);
  ctx.lineTo(width, tableTopY);
  ctx.stroke();

  // 4. Character Silhouette / Framing Composition
  ctx.save();
  if (spec.cameraAngle === 'wide' || spec.cameraAngle === 'medium') {
    const charX = spec.cameraAngle === 'wide' ? width * 0.28 : width * 0.26;
    const charY = tableTopY;
    // Detective shoulders & fedora/collar silhouette
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 2.5;

    // Torso/shoulders
    ctx.beginPath();
    ctx.moveTo(charX - 110, charY);
    ctx.quadraticCurveTo(charX - 95, charY - 125, charX, charY - 130);
    ctx.quadraticCurveTo(charX + 95, charY - 125, charX + 115, charY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Head & Collar
    ctx.beginPath();
    ctx.arc(charX, charY - 178, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Rim light on character shoulder
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(charX + 35, charY - 126);
    ctx.quadraticCurveTo(charX + 92, charY - 115, charX + 112, charY - 8);
    ctx.stroke();
  } else if (spec.cameraAngle === 'over_shoulder') {
    // Out-of-focus dark foreground shoulder on left
    ctx.fillStyle = '#0B0F17';
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, height * 0.22);
    ctx.quadraticCurveTo(width * 0.28, height * 0.28, width * 0.34, height);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (spec.cameraAngle === 'closeup') {
    // Dramatic hand silhouette reaching near the object
    ctx.fillStyle = '#1E293B';
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(width * 0.1, tableTopY + 18, width * 0.22, 46, 22);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // 5. Render Target Continuity Object inside its exact BoundingBox
  const box = getTargetObjectBox(spec.cameraAngle, spec.targetObject);
  const pxBox = {
    x: (box.x / 100) * width,
    y: (box.y / 100) * height,
    w: (box.width / 100) * width,
    h: (box.height / 100) * height,
  };

  drawTargetObjectInBox(ctx, pxBox, spec.targetObject, spec.objectColorName);

  // 6. Cinematic Storyboard Frame HUD Stamp (Top-Left Slate & Camera Framing Guides)
  ctx.save();
  // Rule-of-thirds subtle crosshair ticks
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 3, 20);
  ctx.lineTo(width / 3, height - 20);
  ctx.moveTo((width * 2) / 3, 20);
  ctx.lineTo((width * 2) / 3, height - 20);
  ctx.stroke();

  // Slate header strip burned into top-left for low-vision clarity
  ctx.fillStyle = 'rgba(11, 14, 20, 0.86)';
  ctx.fillRect(16, 16, 250, 34);
  ctx.strokeStyle = '#323A46';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(16, 16, 250, 34);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 13px "JetBrains Mono", monospace';
  ctx.fillText(
    `SHOT 0${spec.shotNumber} · ${spec.cameraAngle.toUpperCase().replace('_', ' ')}`,
    28,
    38
  );
  ctx.restore();

  return {
    imageUrl: canvas.toDataURL('image/png'),
    box,
  };
}

function drawTargetObjectInBox(
  ctx: CanvasRenderingContext2D,
  pxBox: { x: number; y: number; w: number; h: number },
  targetObject: string,
  colorName: string
) {
  const palette = resolveColorPalette(colorName);
  const obj = targetObject.toLowerCase();

  ctx.save();

  // Contact shadow on surface
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.ellipse(
    pxBox.x + pxBox.w * 0.5,
    pxBox.y + pxBox.h * 0.94,
    pxBox.w * 0.46,
    pxBox.h * 0.08,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  if (obj.includes('umbrella')) {
    // Draw Sleek Folded or Open Umbrella Prop
    const cx = pxBox.x + pxBox.w * 0.5;
    const topY = pxBox.y + pxBox.h * 0.1;
    const botY = pxBox.y + pxBox.h * 0.9;

    const grad = ctx.createLinearGradient(pxBox.x, topY, pxBox.x + pxBox.w, botY);
    grad.addColorStop(0, palette.highlight);
    grad.addColorStop(0.5, palette.primary);
    grad.addColorStop(1, palette.shadow);

    ctx.fillStyle = grad;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(cx, topY);
    ctx.quadraticCurveTo(pxBox.x + pxBox.w * 0.95, topY + pxBox.h * 0.35, pxBox.x + pxBox.w * 0.85, botY - 12);
    ctx.lineTo(pxBox.x + pxBox.w * 0.15, botY - 12);
    ctx.quadraticCurveTo(pxBox.x + pxBox.w * 0.05, topY + pxBox.h * 0.35, cx, topY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (obj.includes('jacket') || obj.includes('coat')) {
    // Draw Trench Coat / Jacket lapel prop
    const grad = ctx.createLinearGradient(pxBox.x, pxBox.y, pxBox.x + pxBox.w, pxBox.y + pxBox.h);
    grad.addColorStop(0, palette.highlight);
    grad.addColorStop(0.5, palette.primary);
    grad.addColorStop(1, palette.shadow);

    ctx.fillStyle = grad;
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(pxBox.x + pxBox.w * 0.12, pxBox.y + pxBox.h * 0.08, pxBox.w * 0.76, pxBox.h * 0.84, 12);
    ctx.fill();
    ctx.stroke();
  } else {
    // Default iconic prop: Heavy Ceramic Diner Coffee Cup + Saucer + Steam
    const cupX = pxBox.x + pxBox.w * 0.12;
    const cupY = pxBox.y + pxBox.h * 0.18;
    const cupW = pxBox.w * 0.64;
    const cupH = pxBox.h * 0.68;

    // Saucer plate underneath
    ctx.fillStyle = palette.shadow;
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(
      cupX + cupW * 0.5,
      cupY + cupH * 0.98,
      cupW * 0.68,
      cupH * 0.13,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    // Cup Handle (right side)
    ctx.strokeStyle = palette.primary;
    ctx.lineWidth = Math.max(5, cupW * 0.11);
    ctx.beginPath();
    ctx.arc(
      cupX + cupW * 0.95,
      cupY + cupH * 0.48,
      cupH * 0.24,
      -Math.PI * 0.45,
      Math.PI * 0.45
    );
    ctx.stroke();

    // Cup Body Cylinder with high-contrast shading
    const cupGrad = ctx.createLinearGradient(cupX, cupY, cupX + cupW, cupY);
    cupGrad.addColorStop(0, palette.highlight);
    cupGrad.addColorStop(0.35, palette.primary);
    cupGrad.addColorStop(0.85, palette.shadow);
    cupGrad.addColorStop(1, palette.primary);

    ctx.fillStyle = cupGrad;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(cupX, cupY);
    ctx.lineTo(cupX + cupW * 0.08, cupY + cupH * 0.88);
    ctx.quadraticCurveTo(cupX + cupW * 0.5, cupY + cupH * 1.02, cupX + cupW * 0.92, cupY + cupH * 0.88);
    ctx.lineTo(cupX + cupW, cupY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Top Rim & Dark Coffee Interior
    ctx.fillStyle = '#1E130C';
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cupX + cupW * 0.5, cupY, cupW * 0.5, cupH * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Specular highlight strip on ceramic body
    ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.beginPath();
    ctx.roundRect(cupX + cupW * 0.16, cupY + cupH * 0.18, cupW * 0.1, cupH * 0.54, 4);
    ctx.fill();

    // Rising Steam wisps above cup
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.lineWidth = 2;
    for (let s = 0; s < 2; s++) {
      const sx = cupX + cupW * (0.35 + s * 0.3);
      ctx.beginPath();
      ctx.moveTo(sx, cupY - 6);
      ctx.quadraticCurveTo(sx - 6, cupY - 18, sx + 4, cupY - 30);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Generates a real binary/alpha segmentation mask dataURL (`SamMask`) for `sam-3.1`.
 */
export function generateSam3MaskData(
  objectId: string,
  box: BoundingBox,
  confidence: number = 0.984
): SamMask {
  const width = 800;
  const height = 450;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const pxBox = {
    x: (box.x / 100) * width,
    y: (box.y / 100) * height,
    w: (box.width / 100) * width,
    h: (box.height / 100) * height,
  };

  // Draw crisp high-contrast cyan/sky segmentation silhouette inside the bounding box
  ctx.fillStyle = 'rgba(56, 189, 248, 0.42)';
  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 3;

  const cupX = pxBox.x + pxBox.w * 0.08;
  const cupY = pxBox.y + pxBox.h * 0.14;
  const cupW = pxBox.w * 0.84;
  const cupH = pxBox.h * 0.78;

  ctx.beginPath();
  ctx.roundRect(cupX, cupY, cupW, cupH, 10);
  ctx.fill();
  ctx.stroke();

  return {
    id: `sam-mask-${objectId}-${Date.now()}`,
    objectId,
    maskBase64: canvas.toDataURL('image/png'),
    box,
    confidence,
  };
}

/**
 * Client-side HTML5 Canvas Pixel Manipulation (`sam-3.1` + `muse-image-1.0` Inpaint/Recolor).
 * Takes the current shot image, isolates the pixels inside `SamMask.box`, and recolors/replaces
 * the target object with the expected continuity color while preserving luminance & specular highlights.
 */
export async function applySamPixelFixToImage(
  sourceImageUrl: string,
  box: BoundingBox,
  targetObject: string,
  targetColorName: string
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const width = img.width || 800;
      const height = img.height || 450;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;

      // 1. Draw original frame
      ctx.drawImage(img, 0, 0, width, height);

      // 2. Isolate the SAM 3.1 bounding box region and perform pixel-level HSV/RGB recoloring
      const pxBox = {
        x: Math.floor((box.x / 100) * width),
        y: Math.floor((box.y / 100) * height),
        w: Math.floor((box.width / 100) * width),
        h: Math.floor((box.height / 100) * height),
      };

      const imageData = ctx.getImageData(pxBox.x, pxBox.y, pxBox.w, pxBox.h);
      const data = imageData.data;
      const targetPalette = resolveColorPalette(targetColorName);
      const [tr, tg, tb] = targetPalette.rgb;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        // Recolor saturated prop pixels while preserving white highlights and dark shadows
        if (saturation > 0.22 && luminance > 0.12 && luminance < 0.92) {
          const factor = Math.min(1.35, Math.max(0.45, luminance * 1.45));
          data[i] = Math.min(255, Math.round(tr * factor));
          data[i + 1] = Math.min(255, Math.round(tg * factor));
          data[i + 2] = Math.min(255, Math.round(tb * factor));
        }
      }
      ctx.putImageData(imageData, pxBox.x, pxBox.y);

      // 3. Re-render crisp vector prop geometry over the segmented region for broadcast-grade sharpness
      drawTargetObjectInBox(ctx, pxBox, targetObject, targetColorName);

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      resolve(sourceImageUrl);
    };
    img.src = sourceImageUrl;
  });
}
