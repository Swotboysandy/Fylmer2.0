import React, { useEffect, useState } from 'react';
import { foregroundOpacity } from '../services/sceneTransitions';

interface Props {
  source: string;
  destination?: string;
  mask?: string;
  progress: number;
  description: string;
}

export function SceneTransition({ source, destination, mask, progress, description }: Props) {
  const [cutout, setCutout] = useState<{ source: string; mask: string; url: string } | null>(null);
  const [failedMask, setFailedMask] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!mask || !destination) return;
    async function prepare() {
      try {
        const image = new Image(), selection = new Image();
        image.crossOrigin = selection.crossOrigin = 'anonymous';
        image.src = source; selection.src = mask!;
        await Promise.all([image.decode(), selection.decode()]);
        if (cancelled) return;
        if (image.naturalWidth !== selection.naturalWidth || image.naturalHeight !== selection.naturalHeight)
          throw new Error('Mask dimensions differ');
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(selection, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = pixels.data[i] > 0 ? 255 : 0;
        context.putImageData(pixels, 0, 0);
        context.globalCompositeOperation = 'source-in';
        context.drawImage(image, 0, 0);
        setCutout({ source, mask: mask!, url: canvas.toDataURL() });
        setFailedMask(null);
      } catch { if (!cancelled) setFailedMask(mask!); }
    }
    void prepare();
    return () => { cancelled = true; };
  }, [source, destination, mask]);
  const ready = cutout?.source === source && cutout.mask === mask;
  return (
    <>
      <img src={source} alt={description} className="w-full h-full object-cover" />
      {destination && <img src={destination} alt="" aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        style={{ opacity: progress }} />}
      {ready && destination && <img src={cutout.url} alt="" aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        style={{ opacity: foregroundOpacity(progress) }} />}
      {progress > 0 && <span className="absolute top-3 left-3 bg-[#121417] text-white rounded px-2 py-1 text-xs font-mono">
        Offline dissolve {Math.round(progress * 100)}%{ready ? ' / selection hold' : ''}
        {mask && failedMask === mask ? ' / mask unavailable' : ''}
      </span>}
    </>
  );
}
