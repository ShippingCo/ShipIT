import React, { useRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
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
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={!!open} onOpenChange={next => { if (!next) onClose?.(); }}>
      <DialogPrimitive.Portal><DialogPrimitive.Overlay className="scrim">
      <DialogPrimitive.Content className={cx('dialog', size === 'lg' && 'dialog-lg')} aria-describedby={undefined}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); }}>
        {title != null ? (
          <div className={cx('dlg-title', 'left')}>
            <DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title>
            {!hideClose && <IconButton icon="close" size="sm" label="Close" onClick={onClose} />}
          </div>
        ) : <DialogPrimitive.Title className="workspace-visually-hidden">Dialog</DialogPrimitive.Title>}
        {children}
        {actions && <div className="dlg-actions">{actions}</div>}
      </DialogPrimitive.Content>
      </DialogPrimitive.Overlay></DialogPrimitive.Portal>
    </DialogPrimitive.Root>
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
      title={title ?? 'Confirm action'}
      hideClose
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
        <div className="t-body-md muted">{body}</div>
      </div>
    </Dialog>
  );
}
