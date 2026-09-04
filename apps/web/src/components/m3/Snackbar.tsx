import React, { createContext, useCallback, useContext, useState } from 'react';
import { Msym } from './Icon';

export type ToastTone = 'ok' | 'err' | 'info';

export interface ToastAction {
  label: React.ReactNode;
  onClick?: () => void;
}

export interface ToastOptions {
  tone?: ToastTone;
  action?: ToastAction;
  /** How long it stays up, in milliseconds. */
  ms?: number;
}

export type ToastFn = (msg: string, opts?: ToastOptions) => void;

interface Toast {
  id: string;
  msg: string;
  tone: ToastTone;
  action?: ToastAction;
  /** Set for the fade-out frame before the toast is removed. */
  out?: boolean;
}

const ToastCtx = createContext<ToastFn>(() => {});

const TONES: Record<ToastTone, { icon: string; color: string }> = {
  ok: { icon: 'check_circle', color: '#a5d6a7' },
  err: { icon: 'error', color: '#f2b8b5' },
  info: { icon: 'info', color: '#aac7fa' },
};

export function ToastProvider({ children }: { children?: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback<ToastFn>((msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, tone: opts.tone || 'ok', action: opts.action }]);
    setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, out: true } : x)));
      setTimeout(() => remove(id), 240);
    }, opts.ms || 4200);
  }, [remove]);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="snack-host">
        {toasts.map((t) => (
          <div key={t.id} className={`snack${t.out ? ' out' : ''}`}>
            <Msym name={(TONES[t.tone] || TONES.ok).icon} style={{ color: (TONES[t.tone] || TONES.ok).color }} />
            <span dangerouslySetInnerHTML={{ __html: t.msg }} />
            {t.action && (
              <button
                className="snack-action"
                onClick={() => { t.action?.onClick?.(); remove(t.id); }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
