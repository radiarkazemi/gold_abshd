import { useEffect, useRef, useState } from "react";
import {
  formatMMSS,
  localDeadlineMsFromOrder,
  DEFAULT_PENDING_SECONDS,
} from "../utils/orderCountdown";

/**
 * Live MM:SS countdown for a pending order on the admin side.
 * Anchored to absolute pending_deadline_at so dashboard and Orders
 * tab stay synchronized for the same order.
 */
export default function PendingCountdown({ order, onExpire }) {
  const deadlineRef = useRef(localDeadlineMsFromOrder(order));
  const expiredRef = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000))
  );

  useEffect(() => {
    deadlineRef.current = localDeadlineMsFromOrder(order);
    expiredRef.current = false;
    setSecondsLeft(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    // Re-anchor only when the server deadline itself changes - NOT on
    // every poll of seconds_remaining (that was desyncing surfaces).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.pending_deadline_at, order?.retry_count]);

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.(order.id);
      }
    }, 250);
    return () => clearInterval(id);
  }, [order?.id, onExpire]);

  if (secondsLeft <= 0) {
    return <span className="order-card__countdown order-card__countdown--expired">۰۰:۰۰</span>;
  }

  return (
    <span className={`order-card__countdown ${secondsLeft <= 15 ? "order-card__countdown--urgent" : ""}`}>
      {formatMMSS(secondsLeft)}
    </span>
  );
}

/**
 * Circular animated countdown for the customer waiting card.
 * `totalSeconds` is the full window length (defaults to 60).
 */
export function CircularCountdown({ order, totalSeconds = DEFAULT_PENDING_SECONDS, onExpire }) {
  const deadlineRef = useRef(localDeadlineMsFromOrder(order));
  const expiredRef = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000))
  );

  useEffect(() => {
    deadlineRef.current = localDeadlineMsFromOrder(order);
    expiredRef.current = false;
    setSecondsLeft(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.pending_deadline_at, order?.retry_count]);

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.(order?.id);
      }
    }, 250);
    return () => clearInterval(id);
  }, [order?.id, onExpire]);

  const span = Math.max(1, Number(totalSeconds) || DEFAULT_PENDING_SECONDS);
  const progress = Math.min(1, Math.max(0, secondsLeft / span));
  const size = 112;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);
  const urgent = secondsLeft > 0 && secondsLeft <= 15;

  return (
    <div className={`circle-countdown ${urgent ? "is-urgent" : ""} ${secondsLeft <= 0 ? "is-expired" : ""}`}>
      <svg className="circle-countdown__svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="circle-countdown__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          className="circle-countdown__progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="circle-countdown__label">{formatMMSS(secondsLeft)}</span>
    </div>
  );
}
