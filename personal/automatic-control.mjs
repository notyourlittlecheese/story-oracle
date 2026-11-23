// Personal fork: chat-local permission and task lifetime, independent of feature settings.
export const CONTROL_KEY = 'storyOracle_automaticControl';
export const FACT_PRIORITY = '【剧情事实优先】主聊天已经发生的事件和用户明确确认的事实优先于以下规划。规划只代表尚待实现的安排；已发生的事件不得重复演出，失效的前提不得强行恢复，不得用预定关系或推测心理覆盖实际互动。信息不足时保留不确定性，跟随当前剧情。';

export function createAutomaticControl({ metadata, chatKey, messageCount, save }) {
    let epoch = 0;
    const read = () => metadata()?.[CONTROL_KEY] || {};
    const enabled = () => read().paused !== true;
    function ticket() { return { epoch, key: chatKey(), md: metadata() }; }
    function valid(t) { return !!t && enabled() && t.epoch === epoch && t.key === chatKey() && t.md === metadata(); }
    function invalidate() { epoch++; }
    function setPaused(paused) {
        const md = metadata();
        if (!md || paused === !enabled()) return false;
        invalidate();
        const old = read();
        const count = messageCount();
        md[CONTROL_KEY] = paused
            ? { ...old, paused: true, since: count }
            : { paused: false, spans: [...(old.spans || []), [old.since ?? count, count]] };
        save();
        return true;
    }
    function elapsed(since) {
        const st = read(), count = messageCount();
        const spans = [...(st.spans || []), ...(st.paused ? [[st.since ?? count, count]] : [])];
        const omitted = spans.reduce((n, [a, b]) => n + Math.max(0, Math.min(count, b) - Math.max(since, a)), 0);
        return Math.max(0, count - since - omitted);
    }
    return { enabled, ticket, valid, invalidate, setPaused, elapsed };
}
