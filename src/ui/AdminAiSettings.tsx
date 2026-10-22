import { useState } from 'react';
import { AiSettingsControls } from './AiSettingsControls';
import { Modal } from './Modal';
export function AdminAiSettings() {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn btn--tiny" onClick={() => setOpen(true)}>人机配置</button>
    {open && <Modal title="人机配置 · 仅开发admin" onClose={() => setOpen(false)}>
      <div className="battle-settings__body battle-settings__body--cols-2"><AiSettingsControls /></div>
    </Modal>}</>;
}
