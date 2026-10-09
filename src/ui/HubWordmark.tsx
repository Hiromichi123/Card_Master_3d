import packageInfo from '../../package.json';
import './hubWordmark.css';

export function HubWordmark() {
  return <span className="hub-wordmark">
    <span className="hub-wordmark__name">
      <span className="hub-wordmark__depth" aria-hidden="true">Card Master</span>
      <span className="hub-wordmark__face">Card Master</span>
    </span>
    <span className="hub-wordmark__edition">3D</span>
    <span className="hub-wordmark__version">v{packageInfo.version}</span>
    <span className="hub-wordmark__rule" aria-hidden="true"><i /><b>◆</b><i /></span>
  </span>;
}
