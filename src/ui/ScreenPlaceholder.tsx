import { ComingSoonBadge } from './ComingSoonBadge';

/**
 * 还没实现的屏幕。
 *
 * 存在的意义是让路由先接通：主菜单的入口点得进来、导航栏切得过去，
 * 而不是点了没反应或者整页崩溃。每一块在对应的里程碑里被真正的屏幕替换掉，
 * 剩到最后的应该只有真正的 P6 内容。
 */
export function ScreenPlaceholder({ title, note }: { title: string; note?: string }) {
  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="screen__title">
          {title}
          <ComingSoonBadge />
        </h1>
      </header>
      <div className="screen__body">
        <p className="screen__note">{note ?? '这一块正在施工。'}</p>
      </div>
    </div>
  );
}
