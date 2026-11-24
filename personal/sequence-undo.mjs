// Restore the last completed beat; preserve every beat's text, ID and custom fields.
export function previousCompletedIndex(seq) {
    if (!seq || !Array.isArray(seq.beats)) return -1;
    const end = Math.min(seq.cursor ?? seq.beats.length, seq.beats.length);
    for (let i = end - 1; i >= 0; i--) if (seq.beats[i].status === 'done') return i;
    return -1;
}
export function undoSequenceCompletion(seq, now, nonce) {
    const index = previousCompletedIndex(seq);
    if (index < 0) return false;
    for (const beat of seq.beats) if (beat.status === 'active') beat.status = 'pending';
    seq.beats[index].status = 'active';
    seq.cursor = index;
    seq.beatStartAt = now;
    seq.reminded = false;
    seq.pulseNonce = nonce;
    delete seq.pulseHint;
    return true;
}
