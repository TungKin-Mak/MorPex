import { EventBus } from '../common/EventBus.js';

export type AlertLevel = 'INFO' | 'WARNING' | 'CRITICAL';
export interface Alert { id: string; level: AlertLevel; source: string; title: string; message: string; timestamp: number; }

export class AlertEngine {
  private static instance: AlertEngine;
  private alerts: Alert[] = [];
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  static getInstance(): AlertEngine {
    if (!AlertEngine.instance) AlertEngine.instance = new AlertEngine();
    return AlertEngine.instance;
  }

  init(eventBus: EventBus): void { this.eventBus = eventBus; }

  emit(level: AlertLevel, source: string, title: string, message: string): void {
    const alert: Alert = { id: `alert_${Date.now()}_${this.alerts.length}`, level, source, title, message, timestamp: Date.now() };
    this.alerts.push(alert);
    this.eventBus?.emit({
      id: alert.id, type: `governance.alert.${level.toLowerCase()}`, timestamp: Date.now(),
      executionId: 'governance', source: 'alert-engine', payload: alert,
    });
  }

  getRecent(limit: number = 20): Alert[] { return [...this.alerts].reverse().slice(0, limit); }
  getByLevel(level: AlertLevel): Alert[] { return this.alerts.filter(a => a.level === level); }
  getAll(): Alert[] { return [...this.alerts]; }
}
