import { tr } from './i18n.js';

// Runtime errors remain in diagnostics. This footer uses only known, translated
// player messages; incoming exception strings must never enter the DOM.
const COPY = {
  checking: 'VR 헤드셋 확인 중...',
  'check-failed': '헤드셋 확인 시간이 초과되었습니다. 연결을 확인한 뒤 CHECK VR AGAIN을 눌러 주세요',
  permission: '헤드셋이나 브라우저에서 VR 요청을 허용해 주세요',
  'permission-slow': 'VR 시작을 기다리고 있습니다. 헤드셋을 준비하고 표시된 요청을 확인해 주세요',
  'permission-stalled': 'VR 시작에 대한 헤드셋의 응답을 아직 기다리고 있습니다',
  graphics: 'VR 화면 준비 중...',
  'reference-space': '플레이 공간 준비 중...',
  attaching: '게임을 헤드셋에 연결하는 중...',
  'viewer-pose': '헤드셋 추적을 기다리는 중...',
  'viewer-pose-slow': '추적이 지연되고 있습니다. 헤드셋을 착용하고 연결을 확인해 주세요',
  ending: 'VR에서 나가는 중...',
  'ending-slow': '헤드셋의 VR 종료를 기다리는 중...',
  recovering: 'VR 연결을 복구하는 중...',
  'recovery-stalled': '헤드셋의 VR 종료를 확인하지 못했습니다',
  failed: 'VR을 시작하지 못했습니다. 헤드셋을 확인하고 다시 시도해 주세요',
  cancelled: 'VR 시작을 취소했습니다',
  cancelling: 'VR 시작을 취소하는 중...',
  'attachment-stalled': 'VR 연결이 완료되지 않고 있습니다',
};
const REOPEN = '가능하면 먼저 저장한 뒤 게임 창을 닫고 다시 여세요';

export function createXrStatus(container, { onCancel, onRecover } = {}) {
  const document = container.ownerDocument || globalThis.document;
  const root = document.createElement('div'), text = document.createElement('span');
  const help = document.createElement('span'), actions = document.createElement('div');
  const cancel = document.createElement('button'), recover = document.createElement('button');
  root.className = 'xr-status'; root.hidden = true;
  root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite'); root.setAttribute('aria-atomic', 'true');
  text.className = 'xr-status__message'; help.className = 'xr-status__help';
  cancel.className = 'xr-status__cancel'; cancel.type = 'button'; cancel.hidden = true; cancel.disabled = true;
  cancel.textContent = tr('VR 시작 취소');
  recover.className = 'xr-status__recover'; recover.type = 'button'; recover.hidden = true; recover.disabled = true;
  recover.textContent = tr('VR 연결 재설정'); actions.className = 'xr-status__actions'; actions.hidden = true;
  actions.append(cancel, recover); root.append(text, help, actions); container.append(root);
  let currentStage = 'idle', pendingStage = null;
  for (const [button, callback] of [[cancel, onCancel], [recover, onRecover]]) button.addEventListener('click', () => {
    if (root.hidden || button.hidden || button.disabled) return;
    pendingStage = currentStage; cancel.disabled = true; recover.disabled = true;
    callback?.();
  });
  return {
    update({ stage = 'idle', canCancel = false, canRecover = false, needsReload = false } = {}) {
      if (currentStage !== stage) pendingStage = null;
      currentStage = stage;
      const copy = Object.hasOwn(COPY, stage) ? COPY[stage] : null;
      root.hidden = !copy;
      if (!copy) {
        text.textContent = ''; help.textContent = ''; help.hidden = true;
        actions.hidden = true; cancel.hidden = true; cancel.disabled = true; recover.hidden = true; recover.disabled = true;
        return;
      }
      const reopen = needsReload || stage === 'attachment-stalled' || stage === 'recovery-stalled';
      text.textContent = tr(copy);
      help.textContent = reopen ? tr(REOPEN) : ''; help.hidden = !reopen;
      cancel.hidden = canCancel !== true || reopen || typeof onCancel !== 'function';
      recover.hidden = canRecover !== true || reopen || typeof onRecover !== 'function';
      cancel.disabled = cancel.hidden || pendingStage === stage;
      recover.disabled = recover.hidden || pendingStage === stage;
      actions.hidden = cancel.hidden && recover.hidden;
    },
  };
}
