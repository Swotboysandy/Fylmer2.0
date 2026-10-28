import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionAt, foregroundOpacity } from '../src/services/sceneTransitions.ts';
test('dissolve follows time in both scrub directions', () => {
 assert.deepEqual(transitionAt([4,3],3.5),{index:0,progress:0.5});
 assert.deepEqual(transitionAt([4,3],4),{index:1,progress:0});
 assert.deepEqual(transitionAt([4,3],3),{index:0,progress:0});
});
test('short shots, final frame and disabled transitions', () => {
 assert.ok(Math.abs(transitionAt([0.4,3],0.3).progress - 0.5) < 1e-9);
 assert.deepEqual(transitionAt([4,3],99),{index:1,progress:0});
 assert.deepEqual(transitionAt([4,3],3.5,false),{index:0,progress:0});
 assert.deepEqual(transitionAt([],0),{index:0,progress:0});
 assert.deepEqual(transitionAt([4,3],-1),{index:0,progress:0});
});
test('selection holds then releases continuously before boundary', () => {
 assert.equal(foregroundOpacity(0.5),1);
 assert.equal(foregroundOpacity(0.75),1);
 assert.equal(foregroundOpacity(0.875),0.5);
 assert.equal(foregroundOpacity(1),0);
});
