import {useState} from 'react';
import {Button} from './ui/button';
import {Textarea} from './ui/textarea';
import type {StoryboardShot} from '../types/framelock';
export function SceneDetailsEditor({shot,disabled,onSave}:{shot:StoryboardShot;disabled:boolean;onSave:(id:string,prompt:string,duration:number)=>void}){
 const [prompt,setPrompt]=useState(shot.promptDescription);
 const [duration,setDuration]=useState(String(shot.durationSeconds));
 const [saved,setSaved]=useState(false);
 const seconds=Number(duration),valid=prompt.trim().length>0&&duration.trim()!==''&&Number.isFinite(seconds)&&seconds>=0.5&&seconds<=60;
 const dirty=prompt.trim()!==shot.promptDescription||seconds!==shot.durationSeconds;
 return <aside className="scene-details-editor" aria-label="Selected scene details">
 <header><span>SCENE {String(shot.shotNumber).padStart(2,'0')}</span><h2>Scene details</h2></header>
 <form onSubmit={event=>{event.preventDefault();if(valid&&dirty){onSave(shot.id,prompt.trim(),seconds);setSaved(true);}}}>
 <div className="scene-editor-field"><label htmlFor="scene-prompt">Prompt</label><Textarea id="scene-prompt" value={prompt} onChange={event=>{setPrompt(event.target.value);setSaved(false)}} rows={5} maxLength={4000} disabled={disabled}/></div>
 <div className="scene-editor-field"><label htmlFor="scene-duration">Duration <span>seconds</span></label><input id="scene-duration" type="number" min="0.5" max="60" step="0.1" value={duration} onChange={event=>{setDuration(event.target.value);setSaved(false)}} disabled={disabled}/></div>
 <div className="scene-editor-status"><span>Continuity</span><strong>{shot.status==='consistent'?'Checked':shot.status==='mismatch'?'Needs attention':'Not checked'}</strong></div>
 <Button type="submit" className="w-full" disabled={disabled||!valid||!dirty}>Save changes</Button>
 <p role="status" className="scene-editor-feedback">{saved?'Changes saved':dirty?'Unsaved changes':'Prompt edits do not regenerate the image.'}</p>
 </form></aside>;
}
