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
import { saveBackupFile, validateVault } from '@/lib/codexpulse/vault';

type Phase = 'booting' | 'unpaired' | 'pairing' | 'recovery' | 'locked' | 'ready' | 'error';
type FailedUnlocks = { count: number; lockUntil: number };

async function fetchEnvelope(dataUrl: string, signal: AbortSignal) {
  const response = await fetch(dataUrl, { cache: 'no-store', signal });
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
  const vaultRef = useRef<LocalVault>(EMPTY_VAULT);
  const saves = useRef<Promise<unknown>>(Promise.resolve());
  const session = useRef(0);
  const network = useRef<AbortController | null>(null);
  const pendingVault = useRef<string | null>(null);
  const revision = useRef(0);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'failed'>('saved');
  const hiddenLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const assertSession = useCallback((generation: number) => {
    if (session.current !== generation || (hiddenAt.current !== null && Date.now() - hiddenAt.current >= 5 * 60_000)) throw new Error('SESSION_CANCELLED');
  }, []);

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

  const loadData = useCallback(async (key: CryptoKey, bundle: ProtectedKeyBundle, generation: number) => {
    assertSession(generation);
    network.current?.abort();
    const controller = new AbortController();
    network.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const envelope = await fetchEnvelope(bundle.dataUrl, controller.signal);
      if (envelope.keyId !== bundle.keyId) throw new Error('KEY_ID');
      const nextSnapshot = await decryptSnapshot(envelope, key);
      assertSession(generation);
      await secureStorage.set(storageKeys.snapshot, envelope);
      assertSession(generation);
      return { snapshot: nextSnapshot, offline: false };
    } catch {
      assertSession(generation);
      const envelope = await loadCachedEnvelope();
      if (!envelope || envelope.keyId !== bundle.keyId) throw new Error('NO_SNAPSHOT');
      const nextSnapshot = await decryptSnapshot(envelope, key);
      assertSession(generation);
      return { snapshot: nextSnapshot, offline: true };
    } finally {
      clearTimeout(timeout);
      if (network.current === controller) network.current = null;
    }
  }, [assertSession]);

  const loadVault = useCallback(async (key: CryptoKey) => {
    await saves.current.catch(() => undefined);
    const encrypted = pendingVault.current || await secureStorage.get<string>(storageKeys.localVault);
    if (!encrypted) return EMPTY_VAULT;
    try { return validateVault(await decryptLocalValue<LocalVault>(encrypted, key)); }
    catch { throw new Error('VAULT_CORRUPT'); }
  }, []);

  const setupPin = useCallback(async (pin: string) => {
    if (!pairing) throw new Error('NO_PAIRING');
    const generation = ++session.current;
    const raw = base64UrlToBytes(pairing.key);
    let bundle: ProtectedKeyBundle, key: CryptoKey, code: string;
    try {
      bundle = await protectMasterKey(pin, raw, pairing.dataUrl);
      key = await importMasterKey(raw);
      code = await recoveryCodeFor(raw);
    } finally { raw.fill(0); }
    const previousBundle = await loadProtectedKey();
    if (previousBundle && previousBundle.keyId !== bundle.keyId) throw new Error('DIFFERENT_KEY');
    const nextVault = await loadVault(key);
    const encryptedVault = await encryptLocalValue(nextVault, key);
    assertSession(generation);
    await secureStorage.setMany([[storageKeys.protectedKey, bundle], [storageKeys.localVault, encryptedVault]]);
    await secureStorage.remove(storageKeys.failedUnlocks);
    assertSession(generation);
    pendingVault.current = null;
    setSaveStatus('saved');
    setProtectedKey(bundle);
    setMasterKey(key);
    vaultRef.current = nextVault;
    setVault(nextVault);
    setPairing(null);
    setRecoveryCode(code);
    try {
      const data = await loadData(key, bundle, generation);
      assertSession(generation);
      setSnapshot(data.snapshot);
      setOfflineData(data.offline);
    } catch {
      assertSession(generation);
      setSnapshot(null);
    }
    setPhase('recovery');
    return code;
  }, [assertSession, loadData, loadVault, pairing]);

  const recover = useCallback(async (code: string) => {
    const generation = ++session.current;
    const raw = await rawKeyFromRecoveryCode(code);
    try {
      const existing = await loadProtectedKey();
      const recoveryKeyId = existing?.keyId;
      const recoveryDataUrl = existing?.dataUrl;
      const recoveredId = await keyIdFor(raw);
      if (recoveryKeyId && recoveredId !== recoveryKeyId) throw new Error('DIFFERENT_KEY');
      if (session.current !== generation || (hiddenAt.current !== null && Date.now() - hiddenAt.current >= 5 * 60_000)) throw new Error('SESSION_CANCELLED');
      setPairing({
        version: 1,
        appUrl: window.location.href,
        dataUrl: recoveryDataUrl || defaultDataUrl.current,
        key: bytesToBase64Url(raw),
        keyId: recoveredId,
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
    const generation = ++session.current;
    const attempts = (await secureStorage.get<FailedUnlocks>(storageKeys.failedUnlocks)) || { count: 0, lockUntil: 0 };
    if (attempts.lockUntil > Date.now()) throw new Error('LOCKED_OUT');
    let key: CryptoKey;
    try {
      const unlocked = await unlockMasterKey(pin, protectedKey);
      key = unlocked.key;
      const { raw } = unlocked;
      raw.fill(0);
    } catch (reason) {
      assertSession(generation);
      const count = attempts.count + 1;
      const lockUntil = count >= 10 ? Date.now() + 5 * 60_000 : count >= 5 ? Date.now() + 30_000 : 0;
      await secureStorage.set(storageKeys.failedUnlocks, { count, lockUntil });
      if (reason instanceof Error && reason.message === 'LOCKED_OUT') throw reason;
      return false;
    }
    await secureStorage.remove(storageKeys.failedUnlocks);
    try {
      const [nextVault, data] = await Promise.all([loadVault(key), loadData(key, protectedKey, generation)]);
      assertSession(generation);
      setMasterKey(key);
      vaultRef.current = nextVault;
      setVault(nextVault);
      setSnapshot(data.snapshot);
      setOfflineData(data.offline);
      setSaveStatus(pendingVault.current ? 'failed' : 'saved');
      setPhase('ready');
      setError(null);
      return true;
    } catch (reason) {
      if (session.current !== generation || (reason instanceof Error && reason.message === 'SESSION_CANCELLED')) return false;
      setMasterKey(null);
      setSnapshot(null);
      vaultRef.current = EMPTY_VAULT;
      setVault(EMPTY_VAULT);
      setError(reason instanceof Error && reason.message === 'VAULT_CORRUPT' ? 'VAULT_CORRUPT' : 'NO_SNAPSHOT');
      setPhase('error');
      return true;
    }
  }, [assertSession, loadData, loadVault, protectedKey]);

  const lock = useCallback(() => {
    if (demo || !protectedKey) return;
    session.current++;
    network.current?.abort();
    setMasterKey(null);
    setPairing(null);
    setRecoveryCode(null);
    setSnapshot(null);
    setVault(EMPTY_VAULT);
    vaultRef.current = EMPTY_VAULT;
    setIsRefreshing(false);
    setPhase('locked');
  }, [demo, protectedKey]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        if (hiddenLockTimer.current) clearTimeout(hiddenLockTimer.current);
        hiddenLockTimer.current = setTimeout(lock, 5 * 60_000);
        return;
      }
      if (hiddenLockTimer.current) clearTimeout(hiddenLockTimer.current);
      if (hiddenAt.current && Date.now() - hiddenAt.current >= 5 * 60_000) lock();
      hiddenAt.current = null;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (hiddenLockTimer.current) clearTimeout(hiddenLockTimer.current);
    };
  }, [lock]);

  const refresh = useCallback(async () => {
    if (!masterKey || !protectedKey || demo) return;
    const generation = session.current;
    setIsRefreshing(true);
    try {
      const data = await loadData(masterKey, protectedKey, generation);
      assertSession(generation);
      setSnapshot(data.snapshot);
      setOfflineData(data.offline);
      setError(null);
    } catch {
      if (session.current !== generation) return;
      setError('NO_SNAPSHOT');
    } finally {
      if (session.current === generation) setIsRefreshing(false);
    }
  }, [assertSession, demo, loadData, masterKey, protectedKey]);

  const persistVault = useCallback((next: LocalVault) => {
    if (!masterKey || demo) return Promise.resolve();
    const generation = session.current;
    const currentRevision = ++revision.current;
    setSaveStatus('saving');
    const operation = saves.current.catch(() => undefined).then(async () => {
      const encrypted = await encryptLocalValue(next, masterKey);
      // Keep only ciphertext in memory if browser storage fails, including across locking.
      pendingVault.current = encrypted;
      await secureStorage.set(storageKeys.localVault, encrypted);
      if (pendingVault.current === encrypted) pendingVault.current = null;
    });
    saves.current = operation;
    void operation.then(() => {
      if (session.current === generation && revision.current === currentRevision) setSaveStatus('saved');
    }, () => {
      if (session.current === generation && revision.current === currentRevision) setSaveStatus('failed');
    });
    return operation;
  }, [demo, masterKey]);

  const updateVault = useCallback((updater: (current: LocalVault) => LocalVault) => {
    const next = validateVault(updater(vaultRef.current));
    vaultRef.current = next;
    setVault(next);
    void persistVault(next).catch(() => undefined);
  }, [persistVault]);

  const retrySave = useCallback(() => persistVault(vaultRef.current), [persistVault]);

  const prepareForUpdate = useCallback(async () => {
    const generation = session.current;
    await saves.current;
    assertSession(generation);
    if (pendingVault.current) throw new Error('SAVE_FAILED');
  }, [assertSession]);

  const backupVault = useCallback(async () => {
    if (!masterKey || !protectedKey) throw new Error('LOCKED');
    const generation = session.current;
    await saves.current.catch(() => undefined);
    assertSession(generation);
    const data = await encryptLocalValue(validateVault(vaultRef.current), masterKey);
    assertSession(generation);
    await saveBackupFile(JSON.stringify({ version: 1, kind: 'codexpulse-vault', keyId: protectedKey.keyId, data }));
  }, [assertSession, masterKey, protectedKey]);

  const restoreVault = useCallback(async (file: File) => {
    if (!masterKey || !protectedKey || file.size > 5_000_000) throw new Error('BACKUP_INVALID');
    const generation = session.current;
    const backup = JSON.parse(await file.text());
    if (backup.version !== 1 || backup.kind !== 'codexpulse-vault' || backup.keyId !== protectedKey.keyId || typeof backup.data !== 'string') throw new Error('BACKUP_INVALID');
    const restored = validateVault(await decryptLocalValue(backup.data, masterKey));
    assertSession(generation);
    const currentRevision = ++revision.current;
    const operation = saves.current.catch(() => undefined).then(async () => {
      assertSession(generation);
      const currentEncrypted = await encryptLocalValue(vaultRef.current, masterKey);
      const restoredEncrypted = await encryptLocalValue(restored, masterKey);
      assertSession(generation);
      await secureStorage.setMany([['vault-before-restore', currentEncrypted], [storageKeys.localVault, restoredEncrypted]]);
      pendingVault.current = null;
      assertSession(generation);
      vaultRef.current = restored;
      setVault(restored);
      if (revision.current === currentRevision) setSaveStatus('saved');
    });
    saves.current = operation;
    await operation;
  }, [assertSession, masterKey, protectedKey]);

  const setLanguage = useCallback((next: Language) => {
    saveLanguage(next);
    setLanguageState(next);
  }, []);

  const enterDemo = useCallback(() => {
    session.current++;
    network.current?.abort();
    setDemo(true);
    setSnapshot(DEMO_SNAPSHOT);
    vaultRef.current = EMPTY_VAULT;
    setVault(EMPTY_VAULT);
    setPhase('ready');
  }, []);

  const resetDevice = useCallback(async () => {
    session.current++;
    network.current?.abort();
    await saves.current.catch(() => undefined);
    await secureStorage.clear();
    pendingVault.current = null;
    vaultRef.current = EMPTY_VAULT;
    setSaveStatus('saved');
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
    updateVault, setLanguage, enterDemo, resetDevice, backupVault, restoreVault,
    saveStatus, retrySave, prepareForUpdate,
  }), [
    phase, language, pairing, protectedKey, snapshot, vault, recoveryCode, offlineData,
    error, isRefreshing, demo, setupPin, recover, finishRecovery, unlock, lock, refresh,
    updateVault, setLanguage, enterDemo, resetDevice, backupVault, restoreVault,
    saveStatus, retrySave, prepareForUpdate,
  ]);
}

export function useServiceWorkerUpdate(prepareForUpdate: () => Promise<void>) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const accepted = useRef(false);

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
            setUpdateAvailable(true);
          }
        });
      });
    }).catch(() => undefined);
    const onController = () => {
      if (accepted.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener('controllerchange', onController);
    };
  }, []);

  const updateNow = useCallback(async () => {
    if (!registration?.waiting || updating) return;
    setUpdating(true);
    setUpdateError(false);
    try {
      await prepareForUpdate();
      accepted.current = true;
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      setUpdateError(true);
      setUpdating(false);
    }
  }, [prepareForUpdate, registration, updating]);

  return { updateAvailable, updateNow, updating, updateError };
}
