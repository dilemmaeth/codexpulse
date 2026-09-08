'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  base64UrlToBytes,
  bytesToBase64Url,
  decryptLocalValue,
  decryptSnapshot,
  encryptLocalValue,
  importMasterKey,
  keyIdFor,
  parsePairingHash,
  protectMasterKey,
  rawKeyFromRecoveryCode,
  recoveryCodeFor,
  unlockMasterKey,
} from '@/lib/codexpulse/crypto';
import { DEMO_SNAPSHOT } from '@/lib/codexpulse/demo';
import {
  loadCachedEnvelope,
  loadProtectedKey,
  preferredLanguage,
  saveLanguage,
  secureStorage,
  storageKeys,
} from '@/lib/codexpulse/storage';
import type {
  CodexPulseSnapshot,
  EncryptedEnvelope,
  Language,
  LocalVault,
  PairingPayload,
  ProtectedKeyBundle,
} from '@/lib/codexpulse/types';
import { EMPTY_VAULT } from '@/lib/codexpulse/types';

type Phase = 'booting' | 'unpaired' | 'pairing' | 'recovery' | 'locked' | 'ready' | 'error';
type FailedUnlocks = { count: number; lockUntil: number };

async function fetchEnvelope(dataUrl: string) {
  const response = await fetch(dataUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`SNAPSHOT_HTTP_${response.status}`);
  const envelope = (await response.json()) as EncryptedEnvelope;
  if (envelope.version !== 1 || envelope.algorithm !== 'A256GCM') throw new Error('ENVELOPE_SCHEMA');
  return envelope;
}

export function useCodexPulse() {
  const [phase, setPhase] = useState<Phase>('booting');
  const [language, setLanguageState] = useState<Language>('hu');
  const [pairing, setPairing] = useState<PairingPayload | null>(null);
  const [protectedKey, setProtectedKey] = useState<ProtectedKeyBundle | null>(null);
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [snapshot, setSnapshot] = useState<CodexPulseSnapshot | null>(null);
  const [vault, setVault] = useState<LocalVault>(EMPTY_VAULT);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [offlineData, setOfflineData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [demo, setDemo] = useState(false);
  const defaultDataUrl = useRef('./codexpulse-data.enc.json');
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const nextLanguage = preferredLanguage();
      if (!active) return;
      setLanguageState(nextLanguage);
      document.documentElement.lang = nextLanguage;

      const payload = parsePairingHash(window.location.hash);
      if (payload) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        setPairing(payload);
        setPhase('pairing');
        return;
      }

      try {
        const configUrl = new URL('codexpulse-config.json', document.baseURI);
        const response = await fetch(configUrl, { cache: 'no-store' });
        if (response.ok) {
          const config = await response.json() as { version?: number; dataUrl?: string };
          if (config.version === 1 && typeof config.dataUrl === 'string' && config.dataUrl.length > 0) {
            defaultDataUrl.current = config.dataUrl;
          }
        }
      } catch {
        // The same-origin default remains valid for the standard GitHub Pages deployment.
      }

      try {
        const bundle = await loadProtectedKey();
        if (!active) return;
        setProtectedKey(bundle || null);
        setPhase(bundle ? 'locked' : 'unpaired');
      } catch {
        if (!active) return;
        setError('STORAGE');
        setPhase('error');
      }
    })();
    return () => { active = false; };
  }, []);

  const loadData = useCallback(async (key: CryptoKey, bundle: ProtectedKeyBundle) => {
    let envelope: EncryptedEnvelope | undefined;
    let fromCache = false;
    try {
      envelope = await fetchEnvelope(bundle.dataUrl);
      if (envelope.keyId !== bundle.keyId) throw new Error('KEY_ID');
      await secureStorage.set(storageKeys.snapshot, envelope);
    } catch {
      envelope = await loadCachedEnvelope();
      fromCache = true;
    }
    if (!envelope || envelope.keyId !== bundle.keyId) throw new Error('NO_SNAPSHOT');
    const nextSnapshot = await decryptSnapshot(envelope, key);
    setSnapshot(nextSnapshot);
    setOfflineData(fromCache);
    return nextSnapshot;
  }, []);

  const loadVault = useCallback(async (key: CryptoKey) => {
    try {
      const encrypted = await secureStorage.get<string>(storageKeys.localVault);
      if (!encrypted) return EMPTY_VAULT;
      return { ...EMPTY_VAULT, ...(await decryptLocalValue<LocalVault>(encrypted, key)) };
    } catch {
      return EMPTY_VAULT;
    }
  }, []);

  const setupPin = useCallback(async (pin: string) => {
    if (!pairing) throw new Error('NO_PAIRING');
    const raw = base64UrlToBytes(pairing.key);
    const bundle = await protectMasterKey(pin, raw, pairing.dataUrl);
    const key = await importMasterKey(raw);
    const code = await recoveryCodeFor(raw);
    raw.fill(0);
    await secureStorage.set(storageKeys.protectedKey, bundle);
    const encryptedVault = await encryptLocalValue(EMPTY_VAULT, key);
    await secureStorage.set(storageKeys.localVault, encryptedVault);
    setProtectedKey(bundle);
    setMasterKey(key);
    setVault(EMPTY_VAULT);
    setRecoveryCode(code);
    try {
      await loadData(key, bundle);
    } catch {
      setSnapshot(null);
    }
    setPhase('recovery');
    return code;
  }, [loadData, pairing]);

  const recover = useCallback(async (code: string) => {
    const raw = await rawKeyFromRecoveryCode(code);
    try {
      setPairing({
        version: 1,
        appUrl: window.location.href,
        dataUrl: defaultDataUrl.current,
        key: bytesToBase64Url(raw),
        keyId: await keyIdFor(raw),
      });
      setError(null);
      setPhase('pairing');
    } finally {
      raw.fill(0);
    }
  }, []);

  const finishRecovery = useCallback(() => {
    setRecoveryCode(null);
    setPhase(snapshot ? 'ready' : 'error');
    if (!snapshot) setError('NO_SNAPSHOT');
  }, [snapshot]);

  const unlock = useCallback(async (pin: string) => {
    if (!protectedKey) return false;
    const attempts = (await secureStorage.get<FailedUnlocks>(storageKeys.failedUnlocks)) || { count: 0, lockUntil: 0 };
    if (attempts.lockUntil > Date.now()) throw new Error('LOCKED_OUT');
    let key: CryptoKey;
    try {
      const unlocked = await unlockMasterKey(pin, protectedKey);
      key = unlocked.key;
      const { raw } = unlocked;
      raw.fill(0);
    } catch (reason) {
      const count = attempts.count + 1;
      const lockUntil = count >= 10 ? Date.now() + 5 * 60_000 : count >= 5 ? Date.now() + 30_000 : 0;
      await secureStorage.set(storageKeys.failedUnlocks, { count, lockUntil });
      if (reason instanceof Error && reason.message === 'LOCKED_OUT') throw reason;
      return false;
    }
    await secureStorage.remove(storageKeys.failedUnlocks);
    try {
      const [nextVault] = await Promise.all([loadVault(key), loadData(key, protectedKey)]);
      setMasterKey(key);
      setVault(nextVault);
      setPhase('ready');
      setError(null);
      return true;
    } catch {
      setError('NO_SNAPSHOT');
      setPhase('error');
      return true;
    }
  }, [loadData, loadVault, protectedKey]);

  const lock = useCallback(() => {
    if (demo || !protectedKey) return;
    setMasterKey(null);
    setSnapshot(null);
    setVault(EMPTY_VAULT);
    setPhase('locked');
  }, [demo, protectedKey]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        return;
      }
      if (hiddenAt.current && Date.now() - hiddenAt.current >= 5 * 60_000) lock();
      hiddenAt.current = null;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [lock]);

  const refresh = useCallback(async () => {
    if (!masterKey || !protectedKey || demo) return;
    setIsRefreshing(true);
    try {
      await loadData(masterKey, protectedKey);
      setError(null);
    } catch {
      setError('NO_SNAPSHOT');
    } finally {
      setIsRefreshing(false);
    }
  }, [demo, loadData, masterKey, protectedKey]);

  const updateVault = useCallback((updater: (current: LocalVault) => LocalVault) => {
    setVault((current) => {
      const next = updater(current);
      if (masterKey) {
        void encryptLocalValue(next, masterKey).then((encrypted) => secureStorage.set(storageKeys.localVault, encrypted));
      }
      return next;
    });
  }, [masterKey]);

  const setLanguage = useCallback((next: Language) => {
    saveLanguage(next);
    setLanguageState(next);
  }, []);

  const enterDemo = useCallback(() => {
    setDemo(true);
    setSnapshot(DEMO_SNAPSHOT);
    setVault(EMPTY_VAULT);
    setPhase('ready');
  }, []);

  const resetDevice = useCallback(async () => {
    await secureStorage.clear();
    setDemo(false);
    setSnapshot(null);
    setMasterKey(null);
    setProtectedKey(null);
    setPairing(null);
    setVault(EMPTY_VAULT);
    setPhase('unpaired');
  }, []);

  return useMemo(() => ({
    phase, language, pairing, protectedKey, snapshot, vault, recoveryCode, offlineData,
    error, isRefreshing, demo, setupPin, recover, finishRecovery, unlock, lock, refresh,
    updateVault, setLanguage, enterDemo, resetDevice,
  }), [
    phase, language, pairing, protectedKey, snapshot, vault, recoveryCode, offlineData,
    error, isRefreshing, demo, setupPin, recover, finishRecovery, unlock, lock, refresh,
    updateVault, setLanguage, enterDemo, resetDevice,
  ]);
}

export function useServiceWorkerUpdate() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    let active = true;
    const swUrl = new URL('sw.js', document.baseURI).pathname;
    void navigator.serviceWorker.register(swUrl).then((next) => {
      if (!active) return;
      setRegistration(next);
      if (next.waiting) setUpdateAvailable(true);
      next.addEventListener('updatefound', () => {
        const worker = next.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            localStorage.setItem('codexpulse-update-deferred', '1');
            setUpdateAvailable(true);
          }
        });
      });
      if (next.waiting && localStorage.getItem('codexpulse-update-deferred') === '1') {
        next.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }).catch(() => undefined);
    const onController = () => {
      localStorage.removeItem('codexpulse-update-deferred');
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener('controllerchange', onController);
    };
  }, []);

  const updateNow = useCallback(() => {
    localStorage.setItem('codexpulse-update-deferred', '1');
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  }, [registration]);

  return { updateAvailable, updateNow };
}
