'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, KeyRound, LockKeyhole, QrCode, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { t } from '@/lib/codexpulse/i18n';
import type { Language } from '@/lib/codexpulse/types';

function PinInput({ value, onChange, label, onComplete }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  onComplete?: (value: string) => void;
}) {
  return (
    <label className="pin-field">
      <span>{label}</span>
      <InputOTP
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        maxLength={6}
        inputMode="numeric"
        pattern="[0-9]*"
      >
        <InputOTPGroup className="pin-group">
          {Array.from({ length: 6 }, (_, index) => <InputOTPSlot className="pin-slot" index={index} key={index} />)}
        </InputOTPGroup>
      </InputOTP>
    </label>
  );
}

function SecurityShell({ icon, title, body, children }: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <main className="security-shell">
      <section className="security-card">
        <div className="security-brand">
          <span className="pulse-mark"><span /></span>
          <strong>CodexPulse</strong>
        </div>
        <div className="security-icon">{icon}</div>
        <h1>{title}</h1>
        <p>{body}</p>
        {children}
      </section>
    </main>
  );
}

export function UnpairedGate({ language, onDemo, onRecover }: {
  language: Language;
  onDemo: () => void;
  onRecover: (code: string) => Promise<void>;
}) {
  const [showRecovery, setShowRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const recover = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await onRecover(code);
    } catch {
      setMessage(t(language, 'invalidRecovery'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SecurityShell icon={<QrCode />} title={t(language, 'pairingTitle')} body={t(language, 'pairingBody')}>
      <div className="pairing-steps">
        <span><b>1</b>{language === 'hu' ? 'Nyisd meg a CodexPulse párosítót a gépen.' : 'Open the CodexPulse pairing tool on your PC.'}</span>
        <span><b>2</b>{language === 'hu' ? 'Olvasd be a QR-kódot ezzel az iPhone-nal.' : 'Scan its QR code with this iPhone.'}</span>
        <span><b>3</b>{language === 'hu' ? 'Állítsd be a PIN-kódodat.' : 'Set your PIN code.'}</span>
      </div>
      {showRecovery ? (
        <div className="recovery-entry">
          <label htmlFor="recovery-code-input">{t(language, 'enterRecovery')}</label>
          <textarea
            id="recovery-code-input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="CP1-…"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          {message && <p className="form-error" role="alert">{message}</p>}
          <Button size="lg" className="wide-button primary-action" disabled={busy || !code.trim()} onClick={() => void recover()}>
            {busy ? <span className="button-spinner" /> : <KeyRound />}{t(language, 'restore')}
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="lg" className="wide-button" onClick={() => setShowRecovery(true)}>{t(language, 'useRecovery')}</Button>
      )}
      <Button variant="ghost" size="lg" className="wide-button" onClick={onDemo}>{t(language, 'demoMode')}</Button>
    </SecurityShell>
  );
}

export function PinSetupGate({ language, onSetup }: { language: Language; onSetup: (pin: string) => Promise<unknown> }) {
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (pin.length !== 6 || repeat.length !== 6 || pin !== repeat) {
      setMessage(t(language, 'pinMismatch'));
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await onSetup(pin);
    } catch {
      setMessage(t(language, 'loadFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SecurityShell icon={<KeyRound />} title={t(language, 'setupPin')} body={t(language, 'fiveMinuteLock')}>
      <div className="pin-stack">
        <PinInput value={pin} onChange={setPin} label={t(language, 'setupPin')} />
        <PinInput value={repeat} onChange={setRepeat} label={t(language, 'repeatPin')} onComplete={() => void submit()} />
      </div>
      {message && <p className="form-error" role="alert">{message}</p>}
      <Button size="lg" className="wide-button primary-action" disabled={busy || pin.length !== 6 || repeat.length !== 6} onClick={() => void submit()}>
        {busy ? <span className="button-spinner" /> : <ShieldCheck />}{t(language, 'continue')}
      </Button>
    </SecurityShell>
  );
}

export function RecoveryGate({ language, code, onFinish }: { language: Language; code: string; onFinish: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <SecurityShell icon={<ShieldCheck />} title={t(language, 'recoveryTitle')} body={t(language, 'recoveryBody')}>
      <button className="recovery-code" onClick={() => void copy()} aria-label={t(language, 'copy')}>
        <code>{code}</code>{copied ? <Check /> : <Copy />}
      </button>
      <Button variant="outline" className="wide-button" onClick={() => void copy()}>{copied ? t(language, 'copied') : t(language, 'copy')}</Button>
      <Button size="lg" className="wide-button primary-action" onClick={onFinish}>{t(language, 'finish')}</Button>
    </SecurityShell>
  );
}

export function LockedGate({ language, onUnlock }: { language: Language; onUnlock: (pin: string) => Promise<boolean> }) {
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const submit = async (value = pin) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const success = await onUnlock(value);
      if (!success && mounted.current) { setPin(''); setMessage(t(language, 'wrongPin')); }
    } catch {
      if (mounted.current) { setPin(''); setMessage(t(language, 'waitBeforeRetry')); }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <SecurityShell icon={<LockKeyhole />} title={t(language, 'lockedTitle')} body={t(language, 'lockedBody')}>
      <div className="pin-stack single">
        <PinInput value={pin} onChange={setPin} label={t(language, 'lockedBody')} onComplete={(value) => void submit(value)} />
      </div>
      {message && <p className="form-error" role="alert">{message}</p>}
      <Button size="lg" className="wide-button primary-action" disabled={busy || pin.length !== 6} onClick={() => void submit()}>
        {busy ? <span className="button-spinner" /> : <LockKeyhole />}{t(language, 'unlock')}
      </Button>
    </SecurityShell>
  );
}

export function ErrorGate({ language, onRetry }: { language: Language; onRetry: () => void }) {
  return (
    <SecurityShell icon={<ShieldCheck />} title={t(language, 'loadFailed')} body={language === 'hu' ? 'A titkosított helyi másolat sem érhető el.' : 'The encrypted local copy is unavailable too.'}>
      <Button size="lg" className="wide-button primary-action" onClick={onRetry}>{t(language, 'retry')}</Button>
    </SecurityShell>
  );
}
