import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  Focus,
  LoaderCircle,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { brand } from '../brand';
import { download, downloadJson } from '../lib/media';
import {
  DURATION,
  DEFAULT_PLAN,
  SCENES,
  clockLabel,
  readPlan,
  timelineAt,
  type DreamPlan,
} from './timeline';
import { H, W, prepareAssets, recordDream, renderDream, type Assets } from './render';
import './dream.css';

const STORAGE = 'framelock.dream-plan.v1';
function initialPlan(): DreamPlan {
  try {
    const raw = localStorage.getItem(STORAGE);
    const saved = raw ? readPlan(JSON.parse(raw)) : null;
    if (saved) return saved;
  } catch {
    /* Storage is optional. */
  }
  return {
    ...DEFAULT_PLAN,
    captions: [...DEFAULT_PLAN.captions],
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}
export default function DreamStudio() {
  const [plan, setPlan] = useState<DreamPlan>(initialPlan);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('Three sample worlds. One object to carry between them.');
  const [saved, setSaved] = useState(false),
    [progress, setProgress] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    exportAbort = useRef<AbortController | null>(null),
    clock = useRef(0);
  const position = timelineAt(time),
    active = position.blend > 0.5 && !plan.reducedMotion ? position.next : position.index;
  const recording = progress !== null;
  const thumbs = useMemo(
    () => assets?.worlds.map((world) => world.toDataURL('image/jpeg', 0.8)) ?? [],
    [assets],
  );
  const anchorUrl = useMemo(() => assets?.anchor.toDataURL() ?? '', [assets]);
  useEffect(() => {
    document.title = `Dream lab — ${brand.name} (working title)`;
    let alive = true;
    prepareAssets()
      .then((value) => {
        if (alive) setAssets(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      exportAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(plan));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [plan]);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => {
      if (preference.matches) {
        setPlaying(false);
        setPlan((p) => ({ ...p, reducedMotion: true }));
      }
    };
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    clock.current = time;
    if (assets && canvas.current) {
      const ctx = canvas.current.getContext('2d');
      if (ctx) renderDream(ctx, assets, time, plan);
    }
  }, [time, assets, plan]);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now(),
      base = clock.current;
    let raf = 0,
      last = 0;
    const step = (now: number) => {
      const next = Math.min(DURATION, base + (now - start) / 1000);
      if (now - last >= 32 || next === DURATION) {
        setTime(next);
        last = now;
      }
      if (next === DURATION) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  function seek(value: number) {
    setPlaying(false);
    setTime(value);
  }
  function update<K extends keyof DreamPlan>(key: K, value: DreamPlan[K]) {
    setPlan((p) => ({ ...p, [key]: value }));
    setError('');
  }
  async function exportFilm() {
    if (!assets || recording) return;
    setPlaying(false);
    setError('');
    setProgress(0);
    setNotice('Recording the full 20-second preview. Keep this tab visible.');
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      const blob = await recordDream(
        assets,
        { ...plan, captions: [...plan.captions] },
        controller.signal,
        setProgress,
      );
      if (controller.signal.aborted) throw new Error('Export cancelled.');
      const url = URL.createObjectURL(blob);
      download(url, 'dream-journey.webm');
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setNotice('Silent WebM downloaded with your captions. This is the offline animation study.');
    } catch (e) {
      if (controller.signal.aborted) setNotice('Export cancelled. Your dream plan is still saved.');
      else setError(e instanceof Error ? e.message : 'Video export failed.');
    } finally {
      setProgress(null);
      exportAbort.current = null;
    }
  }
  function savePlan() {
    downloadJson(
      {
        ...plan,
        durationSeconds: DURATION,
        worlds: SCENES.map((s) => s.id),
        provenance: {
          visuals: 'Original procedural sample illustrations',
          anchor: 'Cup cutout from the existing hand-authored sample mask',
          modelCalls: 0,
          rendering: 'Canvas layered transitions; not generative video',
        },
      },
      'dream-journey-plan.json',
    );
    setNotice('Dream plan downloaded. It includes the sample asset provenance.');
  }
  return (
    <div className="dream-studio">
      <a className="dream-skip" href="#dream-workspace">
        Skip to dream editor
      </a>
      <header className="dream-header">
        <a href="/" className="dream-brand">
          <span>
            <Focus size={22} />
          </span>
          {brand.name}
          <small>WORKING TITLE</small>
        </a>
        <span className="dream-header-divider" />
        <span className="dream-section-name">Dream lab</span>
        <span className="dream-branch">EXPERIMENT</span>
        <a className="dream-back" href="/">
          <ArrowLeft size={14} />
          Frame lab
        </a>
      </header>
      <main id="dream-workspace" className="dream-main" tabIndex={-1}>
        <div className="dream-heading">
          <div>
            <p className="dream-eyebrow">STORY STUDY / 001</p>
            <h1>A door into the impossible.</h1>
            <p>A familiar object. Three unfamiliar worlds.</p>
          </div>
          <span className="dream-saved">
            <span />
            {saved ? 'Plan saved on this device' : 'Plan stays in this session'}
          </span>
        </div>
        <div className="dream-layout">
          <aside className="dream-sidebar" aria-label="Dream direction">
            <fieldset disabled={recording} className="dream-controls">
              <legend className="sr-only">Dream settings</legend>
              <section className="dream-panel">
                <div className="dream-panel-title">
                  <span>01</span>
                  <h2>Remember the dream</h2>
                </div>
                <label htmlFor="dream-story">Your dream notes</label>
                <textarea
                  id="dream-story"
                  maxLength={2000}
                  rows={6}
                  value={plan.story}
                  onChange={(e) => update('story', e.target.value)}
                  aria-describedby="dream-notes-help"
                />
                <p id="dream-notes-help" className="dream-help">
                  Notes save with your plan. This preview uses the three sample worlds below; it
                  doesn’t generate images from your words yet.
                </p>
              </section>
              <section className="dream-panel">
                <div className="dream-panel-title">
                  <span>02</span>
                  <h2>Choose what stays</h2>
                </div>
                <label className="dream-anchor">
                  <span className="dream-anchor-thumb">
                    {assets ? <img src={anchorUrl} alt="" /> : <Focus size={20} />}
                  </span>
                  <span>
                    <strong>The red mug</strong>
                    <small>One cutout, held in place</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={plan.anchor}
                    onChange={(e) => update('anchor', e.target.checked)}
                    aria-label="Keep the red mug"
                  />
                </label>
                <p className="dream-help">
                  The sample mask comes from Frame lab. Live SAM selection has not been used.
                </p>
              </section>
              <section className="dream-panel">
                <div className="dream-panel-title">
                  <span>03</span>
                  <h2>Let the world change</h2>
                </div>
                <div className="dream-transition" role="group" aria-label="Scene transition">
                  <button
                    aria-pressed={plan.transition === 'doorway'}
                    onClick={() => update('transition', 'doorway')}
                  >
                    <span className="doorway-icon" />
                    Doorway
                  </button>
                  <button
                    aria-pressed={plan.transition === 'dissolve'}
                    onClick={() => update('transition', 'dissolve')}
                  >
                    <Sparkles size={17} />
                    Dissolve
                  </button>
                </div>
                <label className="dream-motion">
                  <input
                    type="checkbox"
                    checked={plan.reducedMotion}
                    onChange={(e) => {
                      setPlaying(false);
                      update('reducedMotion', e.target.checked);
                    }}
                  />
                  Gentle playback
                </label>
                <p className="dream-help">
                  {plan.reducedMotion
                    ? 'Scenes switch with still cuts. Sweeping reveals and water motion are off.'
                    : 'A doorway opens into the next world. The mug stays in the foreground.'}
                </p>
              </section>
            </fieldset>
            <div className="dream-sample-note">
              <span>OFFLINE ANIMATION STUDY</span>
              <p>Original sample artwork and layered transitions. No AI video or Meta calls.</p>
            </div>
          </aside>
          <div className="dream-film-column">
            <section className="dream-player" aria-label="Dream film preview">
              <div className="dream-player-header">
                <span>
                  <Film size={13} />
                  DREAM JOURNEY
                </span>
                <span>
                  {String(active + 1).padStart(2, '0')} / 03 <b>·</b> {SCENES[active].place}
                </span>
              </div>
              <div className="dream-canvas-wrap">
                <canvas
                  ref={canvas}
                  width={W}
                  height={H}
                  role="img"
                  aria-label={`Offline dream illustration: ${SCENES[active].place}. ${plan.anchor ? 'The same red mug cutout stays in the foreground.' : 'The mug is hidden.'}`}
                >
                  <p>{plan.captions[active]}</p>
                </canvas>
                {!assets ? (
                  <div className="dream-loading">
                    <LoaderCircle className="spin" />
                    Preparing sample worlds…
                  </div>
                ) : null}
                <span className="dream-anchor-badge">
                  {plan.anchor ? <LockKeyhole size={12} /> : <Focus size={12} />}{' '}
                  {plan.anchor ? 'Mug anchored' : 'World only'}
                </span>
                <span className="dream-study-badge">SAMPLE VISUALS</span>
              </div>
              <div className="dream-transport">
                <button
                  className="dream-play"
                  disabled={!assets || recording}
                  aria-label={playing ? 'Pause dream' : 'Play dream'}
                  onClick={() => {
                    if (time >= DURATION) {
                      clock.current = 0;
                      setTime(0);
                    }
                    setPlaying((p) => !p);
                  }}
                >
                  {playing ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button
                  className="dream-reset"
                  aria-label="Restart dream"
                  disabled={recording}
                  onClick={() => seek(0)}
                >
                  <RotateCcw size={16} />
                </button>
                <label className="sr-only" htmlFor="dream-time">
                  Dream playhead
                </label>
                <input
                  id="dream-time"
                  type="range"
                  min={0}
                  max={DURATION}
                  step={0.05}
                  value={time}
                  disabled={recording}
                  onChange={(e) => seek(Number(e.target.value))}
                  aria-valuetext={`${time.toFixed(1)} seconds of 20`}
                />
                <span className="dream-time">
                  {clockLabel(time)} <b>/ 00:20</b>
                </span>
              </div>
            </section>
            <div className="dream-scene-heading">
              <h2>Your three worlds</h2>
              <span>Choose a scene to jump. Edit its caption below.</span>
            </div>
            <div className="dream-scenes">
              {SCENES.map((scene, index) => (
                <article
                  className={`dream-scene ${active === index ? 'is-active' : ''}`}
                  key={scene.id}
                >
                  <button
                    onClick={() => seek((index * DURATION) / 3)}
                    disabled={recording}
                    aria-label={`Show ${scene.place}`}
                    aria-pressed={active === index}
                  >
                    <div className="dream-scene-thumb">
                      {thumbs[index] ? <img src={thumbs[index]} alt="" /> : null}
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      {active === index ? <span className="dream-now">ON SCREEN</span> : null}
                    </div>
                    <div className="dream-scene-title">
                      <strong>{scene.place}</strong>
                      <small>{scene.title}</small>
                    </div>
                  </button>
                  <label htmlFor={`caption-${index}`} className="sr-only">
                    Caption for {scene.place}
                  </label>
                  <textarea
                    id={`caption-${index}`}
                    value={plan.captions[index]}
                    rows={3}
                    maxLength={160}
                    disabled={recording}
                    onChange={(e) => {
                      const next = [...plan.captions];
                      next[index] = e.target.value;
                      update('captions', next);
                    }}
                  />
                </article>
              ))}
            </div>
            <section className="dream-delivery" aria-label="Save your dream">
              <div>
                <p className="dream-eyebrow">KEEP THE DREAM</p>
                <h2>Take this little world with you.</h2>
                <p>Download the 20-second silent preview, a still, or your editable plan.</p>
              </div>
              <div className="dream-export-actions">
                <button
                  className="dream-button primary"
                  onClick={() => void exportFilm()}
                  disabled={!assets || recording}
                >
                  <ArrowDownToLine size={16} />
                  {recording ? `Recording ${Math.round(progress! * 100)}%` : 'Export WebM'}
                </button>
                <button
                  className="dream-button"
                  disabled={!assets || recording}
                  onClick={() => {
                    if (canvas.current)
                      download(canvas.current.toDataURL('image/png'), 'dream-frame.png');
                  }}
                >
                  Save frame
                </button>
                <button className="dream-button" onClick={savePlan} disabled={recording}>
                  Save plan
                </button>
              </div>
            </section>
            {recording ? (
              <div className="dream-recording">
                <progress value={progress!} max={1} aria-label="Video export progress" />
                <span>Keep this tab visible while the film records.</span>
                <button className="dream-button" onClick={() => exportAbort.current?.abort()}>
                  <X size={14} />
                  Cancel export
                </button>
              </div>
            ) : null}
            <div className="dream-status" role="status" aria-live="polite">
              <Check size={14} />
              {notice}
            </div>
            {error ? (
              <p className="dream-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <footer className="dream-footer">
          <span>
            <Focus size={13} />
            Framelock / working title
          </span>
          <span>
            Dream experiment <b>·</b> Built for discussion before a merge
          </span>
        </footer>
      </main>
    </div>
  );
}
