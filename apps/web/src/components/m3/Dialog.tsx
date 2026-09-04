import React, { useEffect } from 'react';
import { Msym, cx } from './Icon';
import { IconButton } from './Button';

export interface DialogProps {
  open?: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  size?: 'lg';
  hideClose?: boolean;
}

export function Dialog({ open, onClose, title, children, actions, size, hideClose }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={cx('dialog', size === 'lg' && 'dialog-lg')} role="dialog" aria-modal="true">
        {title != null && (
          <div className={cx('dlg-title', 'left')}>
            <span>{title}</span>
            {!hideClose && <IconButton icon="close" size="sm" label="Close" onClick={onClose} />}
          </div>
        )}
        {children}
        {actions && <div className="dlg-actions">{actions}</div>}
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  open?: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  body?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  /** Red confirm button, centred layout and a warning glyph. */
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, onClose, title, body, confirmLabel = 'Confirm', danger, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-text" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-filled'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </>
      }
    >
      <div style={{ textAlign: danger ? 'center' : 'left' }}>
        {danger && (
          <div className="dlg-icon ic-error"><Msym name="delete_forever" /></div>
        )}
        <div className="t-title-lg" style={{ marginBottom: 10 }}>{title}</div>
        <div className="t-body-md muted">{body}</div>
      </div>
    </Dialog>
  );
}
