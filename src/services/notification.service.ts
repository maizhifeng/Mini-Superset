import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  duration: number;
}

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  toasts = signal<Toast[]>([]);
  private idCounter = 0;

  show(message: string, duration = 3000): void {
    const id = this.idCounter++;
    this.toasts.update(toasts => [...toasts, { id, message, duration }]);
    setTimeout(() => this.remove(id), duration);
  }

  remove(id: number): void {
    this.toasts.update(toasts => toasts.filter(t => t.id !== id));
  }
}
