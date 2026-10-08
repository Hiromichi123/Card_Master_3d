/**
 * 触发浏览器下载一段 JSON 文本。
 *
 * 三个细节都不是随手写的：
 * - **必须 append 到 body 再 click**：Firefox 上一个游离的 `<a>` 不会触发下载；
 * - **延迟 revoke**：立即 `revokeObjectURL` 会在部分 WebKit 上取消尚未开始的下载；
 * - 文件名带日键与 revision，便于玩家自己区分几份导出。
 *
 * 日键取自 `store.todayKey()`（走存档自己的时钟），所以开发期的 `?day=`
 * 也管得到导出文件名——浏览器用例因此可以断言一个确定的文件名。
 */

export function saveFileName(dayKey: string, schemaVersion: number, revision: number): string {
  return `card-master-3d-${dayKey}-v${schemaVersion}-r${revision}.json`;
}

export function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
