import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createAutomaticControl, FACT_PRIORITY } from './automatic-control.mjs';

function fixture() {
    const chats = { A: {}, B: {} }; let key='A', count=10, saves=0;
    const deps = { metadata:()=>chats[key], chatKey:()=>key, messageCount:()=>count, save:()=>saves++ };
    const control=createAutomaticControl(deps);
    return { control, deps, chats, switch:(k)=>{key=k;control.invalidate();}, count:(n)=>{count=n;}, saves:()=>saves };
}
test('pause persists per chat, preserves unrelated state, invalidates old results even after resume', () => {
    const f=fixture(); f.chats.A.sequence={cursor:2, customText:'keep'};
    const t=f.control.ticket(); assert.equal(f.control.enabled(),true);
    f.control.setPaused(true); assert.equal(f.control.valid(t),false);
    assert.equal(createAutomaticControl(f.deps).enabled(),false);
    f.control.setPaused(false); assert.equal(f.control.valid(t),false);
    const t2=f.control.ticket(); f.switch('B'); assert.equal(f.control.valid(t2),false);
    assert.equal(f.control.enabled(),true); f.control.setPaused(true);
    f.switch('A'); assert.equal(f.control.enabled(),true);
    assert.deepEqual(f.chats.A.sequence,{cursor:2,customText:'keep'});
});
test('reminder time excludes all pause intervals, including a beat created while paused', () => {
    const f=fixture(); f.control.setPaused(true); f.count(20);
    assert.equal(f.control.elapsed(5),5); assert.equal(f.control.elapsed(15),0);
    f.control.setPaused(false); f.count(23);
    assert.equal(f.control.elapsed(5),8); assert.equal(f.control.elapsed(15),3);
    f.control.setPaused(true); f.count(25); f.control.setPaused(false); f.count(27);
    assert.equal(f.control.elapsed(5),10);
});
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function fn(name) {
    const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));
    assert.notEqual(start,-1,name);
    const end=source.indexOf('\n}',start)+2;
    return source.slice(start,end);
}
function sandbox(names, globals) {
    const c=vm.createContext(globals);
    vm.runInContext(names.map(fn).join('\n'),c);
    return c;
}
test('real injection function clears both slots and bridge, then restores custom text with fact priority', () => {
    const f=fixture(), slots={}, snapshots=[];
    const beat={customText:'用户手改的正文',intensity:'normal'}, seq={cursor:0,beats:[beat]};
    const c=sandbox(['applyPlanInjection','soFactDirective'],{
        soAutomatic:f.control, FACT_PRIORITY, ENABLE_NEXT_BEAT:false, ENABLE_DB_BRIDGE:true, ENABLE_SEQ_PULSE:true,
        getSettings:()=>({seqPulse:true}), getCtx:()=>({setExtensionPrompt:(k,v)=>slots[k]=v}),
        getActiveConstruct:()=>({type:'seq',seq}), seqActiveBeat:q=>q.beats[q.cursor],buildDirective:b=>b.customText,
        buildSeqPulsePrompt:()=>'<protocol>', SEQ_PULSE_PROMPT_KEY:'pulse',ADVISOR_PROMPT_KEY:'plan',
        dbBridgePublish:s=>snapshots.push(s),dbBridgeChatId:()=> 'A',
    });
    c.applyPlanInjection(); assert.equal(slots.plan,FACT_PRIORITY+'\n\n'+beat.customText); assert.equal(slots.pulse,'<protocol>');
    f.control.setPaused(true); c.applyPlanInjection(); assert.equal(slots.plan,''); assert.equal(slots.pulse,''); assert.equal(snapshots.at(-1),null);
    f.control.setPaused(false); c.applyPlanInjection(); assert.equal(slots.plan,FACT_PRIORITY+'\n\n'+beat.customText);
    assert.equal(seq.cursor,0); assert.equal(beat.customText,'用户手改的正文');
});
test('paused automatic event entrances return before touching model, metadata or event side effects', async () => {
    const f=fixture();f.control.setPaused(true);
    for(const name of ['maybePostReply','checkSeqPulse','checkPlanReminder','dbBridgeAfterCommandsFirst','onPromptReadyGlue','soThrBoardSumKick','nbeatOnMessageReceived','soThrWeiyuOnReceived','soThrBoardOnReceived']) {
        const c=sandbox([name],{soAutomatic:f.control});
        await c[name](0,'normal');
    }
});
test('automatic run lifetime is sticky but manually started work remains permitted', () => {
    const f=fixture(); const run={automaticTicket:f.control.ticket()};
    const c=sandbox(['postReplyShouldStop'],{soAutomatic:f.control,postReplyCancelled:false,activePostReplyRun:run});
    assert.equal(c.postReplyShouldStop(),false);
    f.control.setPaused(true);f.control.setPaused(false);assert.equal(c.postReplyShouldStop(),true);
    c.activePostReplyRun={step:'custom'};f.control.setPaused(true);assert.equal(c.postReplyShouldStop(),false);
});
test('phone and board injection writers clear even while prompt registry is borrowed', () => {
    const f=fixture();f.control.setPaused(true);
    for(const kind of ['Weiyu','Board']) {
        const key='soThr'+kind, slots={};
        const c=sandbox([key+'NoteSync'],{
            soAutomatic:f.control,getCtx:()=>({setExtensionPrompt:(k,v)=>slots[k]=v}),
            [key+'TellOn']:()=>true,[key+'QuietOpen']:()=>false,[key+'NoteText']:()=> 'old',
            [key+'NoteLive']:true,[key+'NoteHeld']:()=>true,soThrBorrowing:()=>true,
            ['THEATER_'+kind.toUpperCase()+'_NOTE_KEY']:'note',['THEATER_'+kind.toUpperCase()+'_NOTE_DEPTH']:1,
            [key+'NoteFilter']:()=>false,
        });
        c[key+'NoteSync']();assert.equal(slots.note,'');
    }
});
test('board background dependencies reject late commits and stale generations; manual work remains available', async () => {
    const f=fixture();let writes=0, check;
    const c=sandbox(['soThrBoardDeps'],{
        soAutomatic:f.control,getCtx:()=>({chat:[]}), getSettings:()=>({contextDepth:10}),
        soThrBoardState:()=>({}), soBdFlowClone:s=>s, soThrBoardCommit:()=>{writes++;return true;},
        fixChatKey:()=> 'A', soThrBoardCanStart:()=>true, soThrBoardRefusal:()=>'',
        soThrBoardPrompt:()=>'',soThrBoardGenerate:async(req,ctl)=>{check=ctl.isStale;return {text:'result'};},
        soThrBoardReaderDeps:()=>({}),soThrBoardChatCx:()=>({}),soThrBoardSumOn:()=>true,
        soThrBoardModsOn:()=>false,soThrBoardArm:()=>({}),
    });
    const auto=c.soThrBoardDeps({silent:true}); await auto.generate({},{});
    f.control.setPaused(true);f.control.setPaused(false);
    assert.equal(check(),true);assert.equal(auto.commit({},'sum'),false);assert.equal(writes,0);
    f.control.setPaused(true);const manual=c.soThrBoardDeps({});
    assert.equal(manual.canStart(),true);assert.equal(manual.commit({},'edit'),true);assert.equal(manual.sumOn,false);
});
test('arc editor stays raw while the displayed injection includes the immutable fact rule', () => {
    const arc={currentBeat:{customText:'custom'}};
    const c=sandbox(['currentInjectionPreview','arcInjectionPreview','soFactDirective'],{
        getActiveConstruct:()=>({type:'arc',arc}),getCtx:()=>({substituteParams:t=>t}),FACT_PRIORITY,
    });
    assert.equal(c.arcInjectionPreview(arc),'custom');
    assert.equal(c.currentInjectionPreview(),FACT_PRIORITY+'\n\ncustom');
});
