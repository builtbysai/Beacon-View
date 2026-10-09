import { useCallback, useEffect, useState } from 'react';

export type SleepMinutes = 0 | 15 | 30 | 60;

/** A wall-clock deadline survives throttled ticks. It cannot execute while the
 * browser/OS suspends the page; wake events check expiry before continuing. */
export function useSleepTimer(cameraId: string) {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [minutes, setMinutes] = useState<SleepMinutes>(0);
  const [remaining, setRemaining] = useState(0);
  const [expired, setExpired] = useState(false);

  const reset = useCallback(() => {
    setDeadline(null);
    setMinutes(0);
    setRemaining(0);
    setExpired(false);
  }, []);
  useEffect(reset, [cameraId, reset]);

  useEffect(() => {
    if (deadline === null) return;
    function check() {
      const left = Math.max(0, deadline! - Date.now());
      setRemaining(Math.ceil(left / 60_000));
      if (left === 0) {
        setDeadline(null);
        setMinutes(0);
        setExpired(true);
      }
    }
    check();
    const interval = window.setInterval(check, 1000);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [deadline]);

  function choose(value: SleepMinutes) {
    setMinutes(value);
    setRemaining(value);
    setDeadline(value ? Date.now() + value * 60_000 : null);
  }
  return { minutes, remaining, expired, choose, reset };
}
