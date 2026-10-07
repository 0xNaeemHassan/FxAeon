'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import styles from './Docs.module.css';

export default function CodeBlock({ code, language = 'TypeScript', label }: { code: string; language?: string; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    setStatus(await copyText(code) ? 'copied' : 'failed');
    timer.current = setTimeout(() => setStatus('idle'), 3000);
  }

  return (
    <figure className={styles.codeBlock}>
      <figcaption className={styles.codeCaption}>
        <span>{label}<span className={styles.codeLanguage}>{language}</span></span>
        <button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          {status === 'copied' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          <span aria-live="polite">{status === 'copied' ? 'Copied' : status === 'failed' ? 'Try again' : 'Copy'}</span>
        </button>
      </figcaption>
      <pre tabIndex={0} aria-label={label}><code>{code}</code></pre>
      {status === 'failed' && <p className={styles.copyError} role="status">Copy was unavailable. Select and copy the example directly.</p>}
    </figure>
  );
}
