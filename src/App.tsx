import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Focus,
  LoaderCircle,
  RotateCcw,
  Scan,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { brand } from './brand';
import { FrameStage, type View } from './components/FrameStage';
import { expandMask, recolor } from './lib/correction';
import {
  download,
  downloadJson,
  loadSample,
  loadUpload,
  maskToUrl,
  pixelsToUrl,
  sampleMask,
} from './lib/media';
import { editSession, initialSession } from './lib/session';
import type { FrameAsset, SegmentationResult, ServiceStatus } from './types';

const colors = [
  { name: 'Cobalt', hex: '#4169d8' },
  { name: 'Forest', hex: '#397d62' },
  { name: 'Ochre', hex: '#bd852a' },
  { name: 'Plum', hex: '#86518d' },
];
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'That action could not be completed.';

export default function App() {
  const [state, dispatch] = useReducer(editSession, initialSession);
  const [service, setService] = useState<ServiceStatus | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [concept, setConcept] = useState('cup');
  const [view, setView] = useState<View>('original');
  const [busy, setBusy] = useState<'load' | 'sample' | 'sam' | null>(null);
  const [notice, setNotice] = useState(
    'Load a selection to begin. Your original will stay intact.',
  );
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const requestVersion = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const selected = state.masks.find((mask) => mask.id === state.selectedId);
  const raster = useMemo(() => (selected ? expandMask(selected) : null), [selected]);
  const overlay = useMemo(
    () => (raster && state.asset ? maskToUrl(raster, state.asset.width, state.asset.height) : null),
    [raster, state.asset],
  );
  const correction = state.candidate ?? state.approved;
  const colorName = colors.find((color) => color.hex === state.color)?.name ?? state.color;
  const validColor = /^#[0-9a-f]{6}$/i.test(state.color);
  const isApproved = Boolean(state.approved && !state.candidate);
  const description =
    state.asset?.kind === 'sample'
      ? `${view === 'correction' && correction ? 'A recoloured' : 'A red'} ceramic cup on a wooden table by a rain-streaked window, with a notebook and plant. This is an original sample illustration.`
      : `Imported frame: ${state.asset?.name ?? 'loading'}. ${view === 'selection' ? 'The chosen object is highlighted.' : view === 'correction' ? 'A colour correction is shown.' : 'The original image is shown.'} Automatic scene description is not available in this first build.`;

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error('Unavailable');
      setService(await response.json());
      setConnectionError(false);
    } catch {
      setConnectionError(true);
    }
  }, []);

  const load = useCallback(async (loader: () => Promise<FrameAsset>) => {
    const version = ++requestVersion.current;
    pending.current?.abort();
    setBusy('load');
    setError('');
    try {
      const asset = await loader();
      if (version !== requestVersion.current) return;
      dispatch({ type: 'load', asset });
      setView('original');
      setNotice(
        asset.kind === 'sample'
          ? 'Sample loaded. Use the offline selection to try a correction.'
          : 'Frame loaded. Connect SAM to select an object in your image.',
      );
    } catch (error) {
      if (version === requestVersion.current) setError(errorText(error));
    } finally {
      if (version === requestVersion.current) setBusy(null);
    }
  }, []);

  useEffect(() => {
    void load(loadSample);
    void refreshStatus();
    return () => {
      requestVersion.current++;
      pending.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, [load, refreshStatus]);
  useEffect(() => {
    document.title = `${brand.name} — ${brand.descriptor}`;
  }, []);

  async function selectSample() {
    if (!state.asset || busy) return;
    const version = ++requestVersion.current;
    setBusy('sample');
    setError('');
    try {
      const mask = await sampleMask(state.asset);
      if (version !== requestVersion.current) return;
      dispatch({ type: 'masks', masks: [mask], sourceHash: state.asset.hash });
      setView('selection');
      setNotice('Cup selected using the hand-authored sample mask. No SAM request was made.');
    } catch (error) {
      if (version === requestVersion.current) setError(errorText(error));
    } finally {
      if (version === requestVersion.current) setBusy(null);
    }
  }

  async function selectWithSam() {
    if (!state.asset || !service?.configured || busy) return;
    const version = ++requestVersion.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy('sam');
    setError('');
    setNotice('SAM is locating the object. The original is unchanged.');
    try {
      const response = await fetch('/api/segment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Framelock-Session': service.sessionToken,
        },
        body: JSON.stringify({ image: state.asset.dataUrl, concept, sourceHash: state.asset.hash }),
        signal: controller.signal,
      });
      const result = (await response.json()) as SegmentationResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'SAM could not complete this selection.');
      if (version !== requestVersion.current) return;
      if (result.sourceHash !== state.asset.hash || !Array.isArray(result.objects))
        throw new Error('The selection does not belong to this frame. Please try again.');
      result.objects.forEach((mask) => {
        if (
          mask.sourceHash !== state.asset!.hash ||
          mask.width !== state.asset!.width ||
          mask.height !== state.asset!.height
        )
          throw new Error(
            'SAM returned a selection for a different source. No correction was applied.',
          );
        expandMask(mask);
      });
      dispatch({ type: 'masks', masks: result.objects, sourceHash: result.sourceHash });
      setView(result.objects.length === 1 ? 'selection' : 'original');
      setNotice(
        result.objects.length === 0
          ? 'SAM found no matches. Try a plain object name or a clearer image; this does not prove the object is absent.'
          : result.objects.length === 1
            ? 'One object selected with SAM. Inspect the mask before correcting it.'
            : `${result.objects.length} objects found. Choose which object to correct.`,
      );
    } catch (error) {
      if (version === requestVersion.current && !controller.signal.aborted) {
        setError(errorText(error));
        setNotice('Selection did not complete. The original is unchanged.');
      }
    } finally {
      if (version === requestVersion.current) setBusy(null);
      void refreshStatus();
    }
  }

  function preview() {
    if (!selected || !raster || !state.asset) return;
    setError('');
    try {
      if (selected.sourceHash !== state.asset.hash)
        throw new Error('Select the object again in the current frame.');
      const result = recolor(state.asset.pixels, raster, state.color);
      if (result.report.changedOutside !== 0)
        throw new Error('The correction affected pixels outside the selection and was rejected.');
      if (result.report.changedInside === 0)
        throw new Error('This colour makes no visible change. Choose another colour.');
      dispatch({
        type: 'preview',
        correction: {
          id: crypto.randomUUID(),
          sourceHash: state.asset.hash,
          selectionId: selected.id,
          color: state.color,
          dataUrl: pixelsToUrl(result.pixels, state.asset.width, state.asset.height),
          report: result.report,
        },
      });
      setView('correction');
      setNotice(
        `${colorName} correction ready for review. No pixels changed outside the selection. Approve it to enable export.`,
      );
    } catch (error) {
      setError(errorText(error));
    }
  }

  function listen() {
    if (!('speechSynthesis' in window)) {
      setError(
        'Speech output is not available in this browser. All descriptions are also written on screen.',
      );
      return;
    }
    window.speechSynthesis.cancel();
    if (speaking) {
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(`${description} ${notice}`);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  function exportEvidence() {
    if (!state.approved || !state.asset || !selected) return;
    downloadJson(
      {
        schemaVersion: 1,
        source: {
          name: state.asset.name,
          sha256: state.asset.hash,
          width: state.asset.width,
          height: state.asset.height,
        },
        segmentation: { ...selected, model: selected.source === 'sam' ? 'sam-3.1' : null },
        correction: {
          id: state.approved.id,
          color: state.approved.color,
          algorithm: 'masked-hsl-v1',
          report: state.approved.report,
          approved: true,
        },
        caveat: 'Pixel preservation does not establish that the mask selected the intended object.',
      },
      'frame-correction-evidence.json',
    );
  }

  return (
    <>
      <a className="skip-link" href="#editor">
        Skip to editor
      </a>
      <header className="app-header">
        <div className="wordmark">
          <span className="brand-symbol">
            <Focus size={24} strokeWidth={1.7} />
          </span>
          <span>
            {brand.name}
            <small>WORKING TITLE</small>
          </span>
        </div>
        <span className="header-divider" />
        <span className="header-label">Frame lab</span>
        <div className="header-actions">
          <span className="local-indicator">
            <i />
            Local workspace
          </span>
          <button
            className="button dark compact"
            disabled={!state.approved || Boolean(state.candidate)}
            onClick={() => {
              if (state.approved) {
                download(state.approved.dataUrl, 'frame-01-corrected.png');
                setNotice('Approved PNG downloaded.');
              }
            }}
          >
            <ArrowDownToLine size={16} />
            Export PNG
          </button>
        </div>
      </header>
      <main id="editor" tabIndex={-1}>
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">OBJECT CORRECTION / FIRST BUILD</p>
            <h1>{state.asset?.name ?? 'Your first frame'}</h1>
            <p className="heading-note">One object. A considered change. Your final say.</p>
          </div>
          <div className="source-actions">
            <input
              ref={uploadInput}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              tabIndex={-1}
              aria-label="Upload a PNG or JPEG"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void load(() => loadUpload(file));
                event.target.value = '';
              }}
            />
            <button className="button outline" onClick={() => uploadInput.current?.click()}>
              <Upload size={16} />
              Open image
            </button>
            {state.asset?.kind === 'upload' ? (
              <button className="text-button" onClick={() => void load(loadSample)}>
                Use sample
              </button>
            ) : null}
          </div>
        </div>
        <div className="workspace-grid">
          <div className="visual-column">
            <FrameStage
              asset={state.asset}
              selected={selected}
              correction={correction}
              approved={isApproved}
              overlay={overlay}
              view={view}
              onView={setView}
              description={description}
            />
            <div className="caption-row">
              <div>
                <span className="caption-label">
                  {state.asset?.kind === 'sample' ? 'THE SAMPLE SCENE' : 'YOUR SOURCE'}
                </span>
                <p>
                  {state.asset?.kind === 'sample'
                    ? 'A quiet window. A red cup. Let’s change just the cup.'
                    : 'Select an object by name. The original image stays available.'}
                </p>
              </div>
              <button className="listen-button" onClick={listen} aria-pressed={speaking}>
                <Volume2 size={16} />
                {speaking ? 'Stop reading' : 'Read aloud'}
              </button>
            </div>
            <section className="revision-strip" aria-label="Frame versions">
              <button
                className={view === 'original' ? 'revision active' : 'revision'}
                onClick={() => setView('original')}
                aria-pressed={view === 'original'}
              >
                {state.asset ? <img src={state.asset.dataUrl} alt="" /> : null}
                <span>
                  <strong>Original</strong>
                  <small>Always retained</small>
                </span>
                <span className="revision-number">01</span>
              </button>
              <ArrowRight size={18} className="revision-arrow" />
              {correction ? (
                <button
                  className={view === 'correction' ? 'revision active' : 'revision'}
                  onClick={() => setView('correction')}
                  aria-pressed={view === 'correction'}
                >
                  <img src={correction.dataUrl} alt="" />
                  <span>
                    <strong>{isApproved ? 'Approved revision' : 'Proposed revision'}</strong>
                    <small>{isApproved ? 'Ready to export' : 'Waiting for your approval'}</small>
                  </span>
                  <span className="revision-number">02</span>
                </button>
              ) : (
                <div className="revision empty">
                  <span className="empty-thumb">
                    <Focus size={20} />
                  </span>
                  <span>
                    <strong>Your correction</strong>
                    <small>Preview before you commit</small>
                  </span>
                  <span className="revision-number">02</span>
                </div>
              )}
            </section>
            <div className="workspace-message" role="status" aria-live="polite" aria-atomic="true">
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <span className="message-dot" />
              )}
              <span>{notice}</span>
            </div>
            {error ? (
              <p className="error-message" role="alert">
                <CircleHelp size={16} />
                {error}
              </p>
            ) : null}
          </div>
          <aside className="inspector" aria-label="Correction controls" aria-busy={Boolean(busy)}>
            <section className="control-section">
              <div className="section-title">
                <span className="step-index">01</span>
                <h2>Select an object</h2>
                {selected ? <Check size={17} className="step-check" /> : null}
              </div>
              <label htmlFor="concept">Object name</label>
              <input
                id="concept"
                value={concept}
                maxLength={100}
                onChange={(event) => setConcept(event.target.value)}
                aria-describedby="concept-help"
                placeholder="e.g. cup"
              />
              <p id="concept-help" className="field-help">
                Use the object’s name, without the colour you want to change.
              </p>
              <button
                className="button outline full"
                disabled={!state.asset || !concept.trim() || !service?.configured || Boolean(busy)}
                onClick={() => void selectWithSam()}
              >
                <Scan size={16} />
                {busy === 'sam' ? 'Finding object…' : 'Find object with SAM'}
              </button>
              {busy === 'sam' ? (
                <button
                  className="text-button"
                  onClick={() => {
                    pending.current?.abort();
                    requestVersion.current++;
                    setBusy(null);
                    setNotice('Selection cancelled. The original is unchanged.');
                  }}
                >
                  Cancel selection
                </button>
              ) : null}
              <details className="connection">
                <summary>
                  <span
                    className={service?.configured ? 'connection-dot ready' : 'connection-dot'}
                  />
                  {connectionError
                    ? 'Connection unavailable'
                    : service?.configured
                      ? 'SAM key configured'
                      : 'SAM not connected'}
                  <ChevronDown size={14} />
                </summary>
                <div>
                  <p>
                    Add your Meta key to <code>.env.local</code> as <code>META_API_KEY</code>. It
                    stays on the local server. Selecting with SAM sends this frame to Meta.
                  </p>
                  <p>
                    {service
                      ? `${service.requestsUsed} of ${service.requestLimit} live calls used this session. No automatic retries.`
                      : 'Start the local server to connect.'}
                  </p>
                  <button className="text-button" onClick={() => void refreshStatus()}>
                    Check connection
                  </button>
                </div>
              </details>
              {state.asset?.kind === 'sample' ? (
                <div className="sample-box">
                  <span className="sample-tag">OFFLINE SAMPLE</span>
                  <p>Try the editor with a hand-authored cup mask. No model call or API key.</p>
                  <button
                    className="sample-button"
                    disabled={Boolean(busy)}
                    onClick={() => void selectSample()}
                  >
                    Use sample selection
                    <ArrowRight size={15} />
                  </button>
                </div>
              ) : null}
              {state.masks.length > 1 ? (
                <fieldset className="object-list">
                  <legend>Choose an object</legend>
                  {state.masks.map((mask) => (
                    <label key={mask.id}>
                      <input
                        type="radio"
                        name="object"
                        checked={selected?.id === mask.id}
                        onChange={() => {
                          dispatch({ type: 'select', id: mask.id });
                          setView('selection');
                          setNotice(
                            `${mask.label} selected. Inspect the mask before correcting it.`,
                          );
                        }}
                      />
                      {mask.label}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {selected ? (
                <div className="selection-summary">
                  <Check size={15} />
                  <span>
                    {selected.label} selected{' '}
                    <small>
                      {selected.source === 'sample'
                        ? 'Hand-authored mask · not SAM output'
                        : `SAM 3.1${selected.confidence === undefined ? '' : ` · model score ${selected.confidence.toFixed(2)}`}`}
                    </small>
                  </span>
                </div>
              ) : null}
            </section>
            <section className="control-section">
              <div className="section-title">
                <span className="step-index">02</span>
                <h2>Change its colour</h2>
              </div>
              <div className="color-options" role="group" aria-label="Target colour">
                {colors.map((color) => (
                  <button
                    key={color.hex}
                    className="color-option"
                    aria-label={color.name}
                    aria-pressed={state.color.toLowerCase() === color.hex}
                    style={{ '--swatch': color.hex } as React.CSSProperties}
                    onClick={() => {
                      dispatch({ type: 'color', color: color.hex });
                      if (state.candidate) setView(state.approved ? 'correction' : 'selection');
                    }}
                  >
                    <span>
                      {state.color.toLowerCase() === color.hex ? <Check size={16} /> : null}
                    </span>
                    <small>{color.name}</small>
                  </button>
                ))}
              </div>
              <div className="hex-row">
                <label htmlFor="color">Custom hex</label>
                <input
                  id="color"
                  value={state.color}
                  maxLength={7}
                  spellCheck={false}
                  aria-invalid={!validColor}
                  aria-describedby="color-help"
                  onChange={(event) => {
                    dispatch({ type: 'color', color: event.target.value });
                    if (state.candidate) setView(state.approved ? 'correction' : 'selection');
                  }}
                />
              </div>
              <p className="field-help" id="color-help">
                {validColor
                  ? 'Keep the original shading. Change hue and saturation inside the mask.'
                  : 'Enter # followed by six hexadecimal digits.'}
              </p>
              <button
                className="button lime full"
                disabled={!selected || !validColor || Boolean(busy)}
                onClick={preview}
              >
                Preview correction
                <ArrowRight size={16} />
              </button>
              {!selected ? (
                <p className="disabled-reason">Select an object to enable correction.</p>
              ) : null}
            </section>
            <section className="control-section review-section">
              <div className="section-title">
                <span className="step-index">03</span>
                <h2>Your final say</h2>
              </div>
              {correction ? (
                <>
                  <div className="pixel-report">
                    <span>Changed outside selection</span>
                    <strong>
                      {correction.report.changedOutside.toLocaleString()} <small>pixels</small>
                    </strong>
                    <p>
                      {correction.report.changedInside.toLocaleString()} pixels changed inside the
                      mask.
                    </p>
                  </div>
                  <p className="field-help">
                    Check the mask edges. This comparison verifies where pixels changed, not whether
                    the right object was selected.
                  </p>
                  {state.candidate ? (
                    <div className="review-actions">
                      <button
                        className="button dark"
                        onClick={() => {
                          dispatch({ type: 'approve' });
                          setNotice('Correction approved. You can now export the PNG or undo it.');
                        }}
                      >
                        <Check size={16} />
                        Approve
                      </button>
                      <button
                        className="button outline"
                        onClick={() => {
                          dispatch({ type: 'reject' });
                          setView(state.approved ? 'correction' : 'original');
                          setNotice('Proposed correction discarded.');
                        }}
                      >
                        <X size={16} />
                        Discard
                      </button>
                    </div>
                  ) : (
                    <div className="approved-note">
                      <Check size={17} />
                      <span>Correction approved</span>
                    </div>
                  )}
                  {state.approved ? (
                    <div className="approved-actions">
                      <button
                        className="text-button"
                        onClick={() => {
                          dispatch({ type: 'undo' });
                          setView('original');
                          setNotice('Original restored. The correction is no longer approved.');
                        }}
                      >
                        <RotateCcw size={14} />
                        Undo correction
                      </button>
                      <button
                        className="text-button"
                        disabled={Boolean(state.candidate)}
                        onClick={exportEvidence}
                      >
                        Save evidence
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="review-placeholder">
                  Preview a correction, compare it with the original, then choose what stays.
                </p>
              )}
            </section>
          </aside>
        </div>
        <footer className="workspace-footer">
          <span>
            <Focus size={13} />A frame at a time.
          </span>
          <span>
            {selected?.source === 'sam' ? 'Live SAM selection' : 'Offline sample available'}{' '}
            <b>·</b> Export to keep your work; refresh resets this session.
          </span>
        </footer>
      </main>
    </>
  );
}
