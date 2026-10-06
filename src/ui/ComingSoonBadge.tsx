/**
 * 「待开发」标记。
 *
 * 措辞只定义一次：融合、自选、Draft、迷宫四个入口都是 P6 的范围，
 * 现在列出来但不假装能用。做成一个组件而不是到处写字符串，
 * 是为了让措辞与样式只有一处——将来某个入口做好时，
 * 去掉一个 prop 就够了。
 */
export function ComingSoonBadge({ stage = 'P6' }: { stage?: string }) {
  return (
    <span className="coming-soon" title={`计划在 ${stage} 阶段实现`}>
      待开发
    </span>
  );
}
