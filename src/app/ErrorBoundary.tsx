import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

/**
 * 顶层错误边界。
 *
 * 3D 场景的失败模式（WebGL 不可用、纹理加载失败、shader 编译失败）在 P1 就会遇到，
 * 这里先把「出错时不是白屏」这件事定下来；具体到 WebGL/纹理/存档的可操作提示
 * 在 P7 补齐（施工清单 P7）。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 控制台保留完整堆栈，便于开发期定位
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  override render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="app-error" role="alert">
        <h1>页面出错了</h1>
        <p className="app-error__message">{error.message}</p>
        <details className="app-error__details">
          <summary>技术细节</summary>
          <pre>{componentStack ?? error.stack ?? '（无堆栈）'}</pre>
        </details>
        <button type="button" className="app-error__retry" onClick={this.handleReset}>
          重试
        </button>
      </div>
    );
  }
}
