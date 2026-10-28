import { Layers2, Scan, Image as ImageIcon } from 'lucide-react';
import type { Correction, FrameAsset, ObjectMask } from '../types';

export type View = 'original' | 'selection' | 'correction';
interface Props {
  asset: FrameAsset | null;
  selected: ObjectMask | undefined;
  correction: Correction | null;
  approved: boolean;
  overlay: string | null;
  view: View;
  onView: (view: View) => void;
  description: string;
}
export function FrameStage({
  asset,
  selected,
  correction,
  approved,
  overlay,
  view,
  onView,
  description,
}: Props) {
  return (
    <section className="stage" aria-label="Frame preview">
      <div className="stage-topline">
        <span>
          <span className="frame-dot" /> FRAME 01
        </span>
        <span>{asset ? `${asset.width} × ${asset.height}` : 'Loading frame'}</span>
      </div>
      <div className="image-well">
        {asset ? (
          <div className="frame-image" style={{ aspectRatio: `${asset.width} / ${asset.height}` }}>
            <img
              className="source-image"
              src={view === 'correction' && correction ? correction.dataUrl : asset.dataUrl}
              alt={description}
            />
            {view === 'selection' && overlay ? (
              <img className="mask-overlay" src={overlay} alt="" aria-hidden="true" />
            ) : null}
            <span className="image-state">
              {view === 'selection'
                ? 'Selection overlay'
                : view === 'correction'
                  ? approved
                    ? 'Approved correction'
                    : 'Correction preview'
                  : 'Original frame'}
            </span>
          </div>
        ) : (
          <div className="frame-placeholder">Loading your frame…</div>
        )}
      </div>
      <div className="stage-toolbar">
        <div className="view-switch" role="group" aria-label="Preview mode">
          <button aria-pressed={view === 'original'} onClick={() => onView('original')}>
            <ImageIcon size={15} />
            Original
          </button>
          <button
            aria-pressed={view === 'selection'}
            disabled={!selected}
            onClick={() => onView('selection')}
          >
            <Scan size={15} />
            Selection
          </button>
          <button
            aria-pressed={view === 'correction'}
            disabled={!correction}
            onClick={() => onView('correction')}
          >
            <Layers2 size={15} />
            Correction
          </button>
        </div>
        <span className="stage-format">
          {asset?.kind === 'sample' ? 'Original illustration' : 'Imported still'}
        </span>
      </div>
    </section>
  );
}
