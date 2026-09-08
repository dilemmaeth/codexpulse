'use client';

import { useMemo } from 'react';
import { Database, Languages, LockKeyhole, RefreshCw, RotateCcw, Settings, ShieldCheck } from 'lucide-react';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { t } from '@/lib/codexpulse/i18n';
import type { CodexPulseSnapshot, Language, LocalVault } from '@/lib/codexpulse/types';

export function SettingsDialog({ language, snapshot, vault, demo, refreshing, offlineData, onLanguage, onVault, onRefresh, onLock, onReset }: {
  language: Language;
  snapshot: CodexPulseSnapshot;
  vault: LocalVault;
  demo: boolean;
  refreshing: boolean;
  offlineData: boolean;
  onLanguage: (language: Language) => void;
  onVault: (updater: (current: LocalVault) => LocalVault) => void;
  onRefresh: () => void;
  onLock: () => void;
  onReset: () => Promise<void>;
}) {
  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of snapshot.tasks) map.set(task.projectId, task.projectName);
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot.tasks]);

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="settings-button" aria-label={t(language, 'settings')} />}>
        <Settings />
      </DialogTrigger>
      <DialogContent className="settings-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t(language, 'settings')}</DialogTitle>
          <DialogDescription>CodexPulse v1</DialogDescription>
        </DialogHeader>
        <div className="settings-scroll">
          <section className="settings-section">
            <div className="settings-section-title"><Languages /><span>{t(language, 'language')}</span></div>
            <Select value={language} onValueChange={(value) => onLanguage(value as Language)}>
              <SelectTrigger className="settings-select"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="hu">Magyar</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
            </Select>
          </section>

          <section className="settings-section">
            <div className="settings-section-title"><Database /><span>{t(language, 'dataAndSync')}</span></div>
            <div className="settings-status-row"><span>{t(language, 'lastSync')}</span><strong>{new Intl.DateTimeFormat(language === 'hu' ? 'hu-HU' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(snapshot.generatedAt))}</strong></div>
            <div className="settings-status-row"><span>{t(language, 'dataQuality')}</span><strong className="secure-label"><ShieldCheck />{offlineData ? t(language, 'offline') : t(language, 'encrypted')}</strong></div>
            <Button variant="outline" className="settings-action" disabled={demo || refreshing} onClick={onRefresh}><RefreshCw className={refreshing ? 'spin' : ''} />{t(language, 'syncNow')}</Button>
          </section>

          <section className="settings-section">
            <div className="settings-section-title"><Settings /><span>{t(language, 'projectRules')}</span></div>
            <div className="project-rule-list">
              {projects.map((project) => {
                const rule = vault.projectRules[project.id] || {};
                return (
                  <div className="project-rule" key={project.id}>
                    <Input aria-label={`${t(language, 'rename')}: ${project.name}`} value={rule.name ?? project.name} onChange={(event) => onVault((current) => ({ ...current, projectRules: { ...current.projectRules, [project.id]: { ...current.projectRules[project.id], name: event.target.value } } }))} />
                    <label className="rule-switch"><span>{t(language, 'hide')}</span><Switch checked={Boolean(rule.hidden)} onCheckedChange={(checked) => onVault((current) => ({ ...current, projectRules: { ...current.projectRules, [project.id]: { ...current.projectRules[project.id], hidden: checked } } }))} /></label>
                    <Select value={rule.mergeInto || 'none'} onValueChange={(value) => onVault((current) => ({ ...current, projectRules: { ...current.projectRules, [project.id]: { ...current.projectRules[project.id], mergeInto: value === 'none' ? null : String(value) } } }))}>
                      <SelectTrigger className="merge-select" aria-label={`${t(language, 'merge')}: ${project.name}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{language === 'hu' ? 'Nincs összevonás' : 'No merge'}</SelectItem>
                        {projects.filter((candidate) => candidate.id !== project.id).map((candidate) => <SelectItem value={candidate.id} key={candidate.id}>{candidate.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-title"><LockKeyhole /><span>{t(language, 'security')}</span></div>
            <p className="settings-note">{t(language, 'fiveMinuteLock')}</p>
            {!demo && <Button variant="outline" className="settings-action" onClick={onLock}><LockKeyhole />{t(language, 'lockNow')}</Button>}
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="destructive" className="settings-action danger-action" />}><RotateCcw />{t(language, 'reset')}</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>{t(language, 'reset')}</AlertDialogTitle><AlertDialogDescription>{language === 'hu' ? 'A telefon párosítása és minden helyi korrekció törlődik. A számítógépen és a GitHubon tárolt titkosított adatok megmaradnak.' : 'Pairing and all local corrections will be removed from this phone. Encrypted data on your PC and GitHub remains intact.'}</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>{t(language, 'cancel')}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void onReset()}>{t(language, 'reset')}</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </section>
        </div>
        <DialogClose render={<Button variant="outline" className="wide-button" />}>{t(language, 'close')}</DialogClose>
      </DialogContent>
    </Dialog>
  );
}
