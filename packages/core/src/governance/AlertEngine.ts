/**
 * AlertEngine — 告警引擎
 * v15: 通过 EventBus 发射治理告警
 */
import { EventBus } from '../common/EventBus.js';

export type AlertLevel = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  message: string;
  timestamp: number;
}

export class AlertEngine {
  private alerts: Alert[] = [];
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  emit(level: AlertLevel, title: string, message: string): void {
    const alert: Alert = {
      id: `alert_${Date.now()}`,
      level,
      title,
      message,
      timestamp: Date.now(),
    };
    this.alerts.push(alert);

    if (this.eventBus) {
      this.eventBus.emit({
        id: alert.id,
        type: `governance.alert.${level.toLowerCase()}`,
        timestamp: Date.now(),
        executionId: 'governance',
        source: 'alert-engine',
        payload: alert,
      });
    }
  }

  getAlerts(level?: AlertLevel): Alert[] {
    return level ? this.alerts.filter(a => a.level === level) : this.alerts;
  }

  getRecent(limit: number = 10): Alert[] {
    return [...this.alerts].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }
}
