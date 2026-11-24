import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {previousCompletedIndex, undoSequenceCompletion} from './sequence-undo.mjs';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function fn(name) { const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m')); assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2); }
test('undo skips skipped beats and preserves every content field, including manual edits',()=>{
    const seq={cursor:3, beats:[{id:1,status:'done',customText:'A'},{id:2,status:'done',goal:'B'},{id:3,status:'skipped'},{id:4,status:'active',customText:'D'}],pulseHint:{beatId:4}};
    assert.equal(undoSequenceCompletion(seq,50,'NEW'),true);
    assert.equal(seq.cursor,1);assert.deepEqual(seq.beats.map(b=>b.status),['done','active','skipped','pending']);
    assert.equal(seq.beats[0].customText,'A');assert.equal(seq.beats[3].customText,'D');assert.equal(seq.pulseHint,undefined);
    assert.equal(undoSequenceCompletion(seq,51,'NEXT'),true);assert.equal(seq.cursor,0);
    assert.equal(undoSequenceCompletion(seq,52,'NO'),false);
});
test('final completion retains sequence, clears active beat, and can be undone after reload',()=>{
    let seq={title:'test',cursor:1,beats:[{id:1,status:'done'},{id:2,status:'active',customText:'keep'}]};
    const c=vm.createContext({getSeq:()=>seq,setSeq:v=>{seq=v;},chatMsgCount:()=>30,seqPulseNonce:()=> 'NEW',applyPlanInjection:()=>{},renderPlanBar:()=>{},addSystemNote:()=>{}});
    vm.runInContext(['seqActiveBeat','seqAdvance','seqComplete'].map(fn).join('\n'),c);
    c.seqComplete();assert.ok(seq);assert.equal(seq.cursor,2);assert.equal(c.seqActiveBeat(seq),null);
    seq=JSON.parse(JSON.stringify(seq));assert.equal(previousCompletedIndex(seq),1);
    assert.equal(undoSequenceCompletion(seq,31,'UNDO'),true);assert.equal(seq.beats[1].status,'active');assert.equal(seq.beats[1].customText,'keep');
});
test('undo confirmation rejects a result after the sequence changed',async()=>{
    const seq={cursor:1,beats:[{id:1,status:'done'},{id:2,status:'active'}]};let resolve, writes=0;
    const c=vm.createContext({getSeq:()=>seq,previousCompletedIndex,fixChatKey:()=> 'A',uiConfirm:()=>new Promise(r=>resolve=r),addSystemNote:()=>{},setSeq:()=>writes++});
    vm.runInContext(fn('seqUndoComplete'),c);
    const task=c.seqUndoComplete();seq.beats[0].goal='changed';resolve(true);await task;
    assert.equal(writes,0);assert.equal(seq.beats[0].status,'done');
});
