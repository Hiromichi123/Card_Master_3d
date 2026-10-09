import { Component, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import packageInfo from '../../package.json';
import { LoginStage } from '../rendering/login/LoginStage';
import { LOGIN_TIMING } from '../rendering/login/motion';
import {
  ACCOUNT_PASSWORD_MAX_LENGTH, ACCOUNT_PASSWORD_MIN_LENGTH, ACCOUNT_USERNAME_MAX_LENGTH,
  authenticateAccount, registerAccount, type LoginAccount,
} from '../services/auth/accounts';
import '../ui/login.css';

interface LoginSceneProps {
  readonly onAuthenticated: (account: LoginAccount) => Promise<void>;
  readonly onReveal: (polygon: string, progress: number) => void;
  readonly onComplete: () => void;
}

type Phase = 'title' | 'descent' | 'cruise';
type Mode = 'intro' | 'form' | 'departing';

/** Authentication lives outside the Canvas: graphics failure must not lock out a local save. */
class LoginVisualBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Accessible fallback for devices without WebGL; it retains the same minimum intro and account flow. */
function FallbackIntro({ departing, onPhaseChange, onReady, onReveal, onComplete }: {
  readonly departing: boolean;
  readonly onPhaseChange: (phase: Phase) => void;
  readonly onReady: () => void;
  readonly onReveal: LoginSceneProps['onReveal'];
  readonly onComplete: () => void;
}) {
  const state = useRef({ time: 0, exit: 0, phase: 'title' as Phase, ready: false, complete: false });
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = document.hidden ? 0 : Math.min((now - last) / 1000, .05);
      last = now;
      const value = state.current;
      value.time += dt;
      const introEnd = LOGIN_TIMING.title + LOGIN_TIMING.descent;
      const phase: Phase = value.time < LOGIN_TIMING.title ? 'title' : value.time < introEnd ? 'descent' : 'cruise';
      if (value.phase !== phase) { value.phase = phase; onPhaseChange(phase); }
      if (value.time >= introEnd + LOGIN_TIMING.minimumCruise && !value.ready) { value.ready = true; onReady(); }
      if (departing && !value.complete) {
        value.exit += dt;
        const p = Math.min(1, Math.max(0, (value.exit - .5) / 1.1));
        if (p > 0) {
          const r = 2 + 65 * p * p;
          onReveal(`polygon(${50 - r}% ${50 - r * 1.5}%, ${50 + r}% ${50 - r * 1.5}%, ${50 + r}% ${50 + r * 1.5}%, ${50 - r}% ${50 + r * 1.5}%)`, p);
        }
        if (p === 1) { value.complete = true; onComplete(); return; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [departing, onComplete, onPhaseChange, onReady, onReveal]);
  return <div className="login-fallback" aria-hidden="true"><i /><i /><i /></div>;
}

export function LoginScene({ onAuthenticated, onReveal, onComplete }: LoginSceneProps) {
  const [phase, setPhase] = useState<Phase>('title');
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>('intro');
  const [verified, setVerified] = useState(false);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [busy, setBusy] = useState<'login' | 'register' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const onReady = useCallback(() => setReady(true), []);
  const begin = useCallback(() => { if (ready && mode === 'intro') setMode('form'); }, [ready, mode]);

  useEffect(() => {
    if (!ready || mode !== 'intro') return;
    const key = (event: KeyboardEvent) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
        event.preventDefault();
        begin();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [begin, mode, ready]);
  useEffect(() => {
    if (mode === 'form') inputRef.current?.focus({ preventScroll: true });
  }, [mode]);

  const authenticate = async (register: boolean) => {
    if (busyRef.current || mode !== 'form') return;
    if (!username.trim() || !password) { setError('请输入账号和密码。'); return; }
    busyRef.current = true;
    setBusy(register ? 'register' : 'login');
    setError('');
    setMessage(register ? '正在创建账号…' : '正在验证账号…');
    try {
      if (register) {
        const account = await registerAccount(username, password);
        if (!mounted.current) return;
        setUsername(account.username);
        setMessage('注册成功，点击「登录」开启旅程。');
      } else {
        const account = await authenticateAccount(username, password);
        if (!mounted.current) return;
        setVerified(true);
        setMessage('验证成功，正在准备大厅…');
        await onAuthenticated(account);
        if (!mounted.current) return;
        setPassword('');
        setMessage('');
        setMode('departing');
      }
    } catch (cause) {
      if (mounted.current) {
        setVerified(false);
        setError(cause instanceof Error ? cause.message : '暂时无法登录，请重试。');
        setMessage('');
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void authenticate(false); };

  return <section className={`login-scene login-scene--${mode}`} data-phase={phase}
    aria-label="Card Master 3D 登录" onClick={begin} data-card-tip-scope="off">
    <div className="login-scene__world" aria-hidden="true">
      <LoginVisualBoundary fallback={<FallbackIntro departing={mode === 'departing'}
        onPhaseChange={setPhase} onReady={onReady} onReveal={onReveal} onComplete={onComplete} />}>
        <LoginStage authenticated={verified} departing={mode === 'departing'} onPhaseChange={setPhase}
          onReady={onReady} onReveal={onReveal} onComplete={onComplete} />
      </LoginVisualBoundary>
    </div>
    <div className="login-scene__vignette" aria-hidden="true" />

    <div className="login-title" aria-hidden={phase !== 'title'}>
      <span className="login-title__eyebrow">THE CARDS AWAIT</span>
      <h1>Card Master <span>3D</span></h1>
      <div className="login-title__rule"><i /><b>命 运 由 此 展 开</b><i /></div>
    </div>

    <div className="login-brand" aria-hidden="true"><span>CM</span><i />CARD MASTER 3D</div>
    {mode === 'intro' && <div className={`login-start-wrap${ready ? ' login-start-wrap--ready' : ''}`}>
      {ready ? <button type="button" className="login-start" onClick={begin}>
        <i aria-hidden="true" />点击任意位置开始游戏<i aria-hidden="true" />
      </button> : <span className="login-start__loading" role="status">{phase === 'title' ? '星 辰 正 在 苏 醒' : '循 光 而 行'}<i /></span>}
    </div>}

    {mode !== 'intro' && <div className="login-form-stage">
      <form className="login-form ui-panel" aria-label="账号登录" aria-busy={busy !== null}
        onSubmit={submit} onClick={(event) => event.stopPropagation()} inert={mode === 'departing'}>
        <div className="login-form__topline" aria-hidden="true"><i /><span>CARD MASTER</span><i /></div>
        <div className="login-form__seal" aria-hidden="true"><span /><i /><b>✦</b></div>
        <header><p>WELCOME, TRAVELER</p><h2>开启你的旅程</h2></header>
        <label className="login-field" htmlFor="login-username"><span>账号<small>ACCOUNT</small></span>
          <input ref={inputRef} id="login-username" name="username" autoComplete="username"
            value={username} onChange={(event) => setUsername(event.target.value)}
            minLength={2} maxLength={ACCOUNT_USERNAME_MAX_LENGTH} required disabled={busy !== null}
            aria-describedby="login-account-hint login-feedback" spellCheck={false} autoCapitalize="none" />
        </label>
        <label className="login-field" htmlFor="login-password"><span>密码<small>PASSWORD</small></span>
          <input id="login-password" name="password" type="password" autoComplete="current-password"
            value={password} onChange={(event) => setPassword(event.target.value)}
            minLength={ACCOUNT_PASSWORD_MIN_LENGTH} maxLength={ACCOUNT_PASSWORD_MAX_LENGTH} required disabled={busy !== null}
            aria-describedby="login-account-hint login-feedback" />
        </label>
        <p className="login-form__hint" id="login-account-hint">初始账号与密码均为 <strong>admin</strong> · 账号保存在此浏览器</p>
        <div className={`login-feedback${error ? ' login-feedback--error' : ''}`} id="login-feedback"
          role={error ? 'alert' : 'status'} aria-live="polite">{error || message || '每一张卡牌，都是新的可能。'}</div>
        <div className="login-form__actions">
          <button type="submit" className="btn btn--primary login-action" disabled={busy !== null}>
            {busy === 'login' ? '正在登录…' : '登 录'}<span aria-hidden="true">↗</span>
          </button>
          <button type="button" className="btn login-action" disabled={busy !== null} onClick={() => void authenticate(true)}>
            {busy === 'register' ? '创建中…' : '注 册'}<span aria-hidden="true">＋</span>
          </button>
        </div>
        <div className="login-form__foot" aria-hidden="true"><i /><span>YOUR STORY BEGINS HERE</span><i /></div>
      </form>
    </div>}

    <footer className="login-footer"><span>星海之间 · 卡牌之境</span><span>v{packageInfo.version}</span></footer>
  </section>;
}
